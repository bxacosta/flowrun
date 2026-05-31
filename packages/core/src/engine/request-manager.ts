/**
 * engine/request-manager.ts — Request runtime
 *
 * Layer: L4 (engine). Tracks pending requests, idempotency, timeouts and
 * responder subscriptions, emitting request:* lifecycle events on the bus.
 */

import { FlowEngineError, normalizeError } from "../core/errors.ts";
import { assertPlainObject } from "../core/validation.ts";
import {
    type AnyPendingRequest,
    type AnyRequestCreatedHandler,
    type AnyRequestDefinition,
    type AnyRequestRecord,
    type EngineRequests,
    isTerminalStatus,
    type PendingRequest,
    RequestAlreadyResolvedError,
    RequestCancelledError,
    type RequestDefinition,
    type RequestFilter,
    RequestNotFoundError,
    type RequestOptions,
    type RequestResponseOptions,
    type RequestSubscribeOptions,
    type RequestSubscription,
    RequestTimeoutError,
    type TerminalRequestStatus,
} from "../definition/request.ts";
import type { AnyEventBus, EmitMeta, EventBusErrorHandler } from "../events/bus.ts";

export interface OpenRequestArgs<TPayload, TResponse> {
    attempt?: number;
    definition: RequestDefinition<TPayload, TResponse>;
    flowName: string;
    iteration?: { index: number; item: unknown };
    nodeName?: string;
    options?: RequestOptions;
    path: readonly string[];
    payload: TPayload;
    runId: string;
    signal: AbortSignal;
}

interface PendingEntry {
    definition: AnyRequestDefinition;
    onAbortTask: () => void;
    reject: (error: Error) => void;
    requestController: AbortController;
    resolve: (value: unknown) => void;
    taskSignal: AbortSignal;
    timer?: ReturnType<typeof setTimeout>;
}

interface SubscriberEntry {
    definition: AnyRequestDefinition;
    handler: AnyRequestCreatedHandler;
}

export interface RequestManager extends EngineRequests {
    open<TPayload, TResponse>(args: OpenRequestArgs<TPayload, TResponse>): Promise<TResponse>;
    pruneRun(runId: string): void;
}

// ── Helpers ─────────────────────────────────────────────────────────

function computeIdempotencyMapKey(args: {
    definitionName: string;
    key: string;
    path: readonly string[];
    runId: string;
}): string {
    return `${args.runId}:${args.path.join("/")}:${args.definitionName}:${args.key}`;
}

function matchesFilter(record: AnyRequestRecord, filter: RequestFilter | undefined): boolean {
    if (!filter) {
        return true;
    }
    if (filter.runId !== undefined && record.runId !== filter.runId) {
        return false;
    }
    if (filter.flowName !== undefined && record.flowName !== filter.flowName) {
        return false;
    }
    if (filter.name !== undefined && record.name !== filter.name) {
        return false;
    }
    if (filter.status !== undefined && record.status !== filter.status) {
        return false;
    }
    return true;
}

function safelyRedact(record: AnyRequestRecord, definition: AnyRequestDefinition): AnyRequestRecord {
    if (!definition.redact) {
        return record;
    }
    try {
        return definition.redact(record);
    } catch {
        return {
            ...record,
            payload: "[REDACTION_ERROR]",
            response: record.response === undefined ? undefined : "[REDACTION_ERROR]",
        };
    }
}

function recordToMeta(record: AnyRequestRecord): EmitMeta {
    return {
        flowName: record.flowName,
        iteration: record.iteration,
        nodeName: record.nodeName,
        path: record.path,
        runId: record.runId,
        source: "runtime",
    };
}

function basePayload(record: AnyRequestRecord): {
    id: string;
    idempotencyKey?: string;
    name: string;
} {
    return {
        id: record.id,
        idempotencyKey: record.idempotencyKey,
        name: record.name,
    };
}

// ── Factory ─────────────────────────────────────────────────────────

export function createRequestManager(bus: AnyEventBus, onError?: EventBusErrorHandler): RequestManager {
    const records = new Map<string, AnyRequestRecord>();
    const pending = new Map<string, PendingEntry>();
    const idempotency = new Map<string, string>();
    const subscribers = new Set<SubscriberEntry>();

    function reportSubscriberError(error: unknown, definitionName: string, requestId: string): void {
        const normalized = normalizeError(error);
        if (!onError) {
            console.error(`[RequestManager] subscriber for "${definitionName}" threw:`, normalized);
            return;
        }
        try {
            onError(normalized, { definitionName, phase: "requestSubscriber", requestId });
        } catch (handlerError) {
            console.error("[RequestManager] onError threw while handling a subscriber error:", {
                onErrorFailure: normalizeError(handlerError),
                originalError: normalized,
            });
        }
    }

    function buildPendingRequest(id: string): AnyPendingRequest {
        const record = records.get(id);
        const entry = pending.get(id);
        if (!(record && entry)) {
            throw new RequestNotFoundError(id);
        }
        return {
            cancel(reason?: string) {
                return cancelById(id, reason);
            },
            flowName: record.flowName,
            id: record.id,
            idempotencyKey: record.idempotencyKey,
            iteration: record.iteration,
            metadata: record.metadata,
            name: record.name,
            nodeName: record.nodeName,
            path: record.path,
            payload: record.payload,
            respond(response: unknown, options?: RequestResponseOptions) {
                return respondById(entry.definition, id, response, options);
            },
            runId: record.runId,
            signal: entry.requestController.signal,
        };
    }

    function notifySubscribers(id: string): void {
        const entry = pending.get(id);
        if (!entry) {
            return;
        }
        for (const subscriber of subscribers) {
            if (subscriber.definition !== entry.definition) {
                continue;
            }
            const pendingRequest = buildPendingRequest(id);
            Promise.resolve(subscriber.handler(pendingRequest)).catch((error: unknown) => {
                reportSubscriberError(error, entry.definition.name, id);
            });
        }
    }

    function detachPendingEntry(entry: PendingEntry): void {
        if (entry.timer) {
            clearTimeout(entry.timer);
        }
        entry.taskSignal.removeEventListener("abort", entry.onAbortTask);
        entry.requestController.abort();
    }

    function transitionToTerminal(
        id: string,
        status: TerminalRequestStatus,
        partial: Partial<AnyRequestRecord>
    ): { entry: PendingEntry; record: AnyRequestRecord } | null {
        const existing = records.get(id);
        const entry = pending.get(id);
        if (!(existing && entry) || existing.status !== "pending") {
            return null;
        }
        const newRecord: AnyRequestRecord = { ...existing, ...partial, status };
        records.set(id, newRecord);
        pending.delete(id);
        detachPendingEntry(entry);
        return { entry, record: newRecord };
    }

    function cancelById(id: string, reason?: string): Promise<void> {
        const existing = records.get(id);
        if (!existing) {
            return Promise.reject(new RequestNotFoundError(id));
        }
        if (existing.status !== "pending") {
            return Promise.resolve();
        }
        const transitioned = transitionToTerminal(id, "cancelled", { cancelledAt: Date.now(), reason });
        if (!transitioned) {
            return Promise.resolve();
        }
        const safe = safelyRedact(transitioned.record, transitioned.entry.definition);
        bus.emit("request:cancelled", { ...basePayload(safe), reason: safe.reason }, recordToMeta(safe));
        transitioned.entry.reject(new RequestCancelledError(transitioned.record.name, id, reason));
        return Promise.resolve();
    }

    function expireById(id: string): void {
        const existing = records.get(id);
        if (!existing || existing.status !== "pending") {
            return;
        }
        const expiredAt = Date.now();
        const transitioned = transitionToTerminal(id, "expired", { expiredAt });
        if (!transitioned) {
            return;
        }
        const safe = safelyRedact(transitioned.record, transitioned.entry.definition);
        bus.emit(
            "request:timeout",
            { ...basePayload(safe), timeoutAt: safe.timeoutAt ?? Date.now() },
            recordToMeta(safe)
        );
        transitioned.entry.reject(
            new RequestTimeoutError(
                transitioned.record.name,
                id,
                transitioned.record.timeoutAt ? transitioned.record.timeoutAt - transitioned.record.createdAt : 0
            )
        );
    }

    function respondById(
        definition: AnyRequestDefinition,
        id: string,
        response: unknown,
        options?: RequestResponseOptions
    ): Promise<void> {
        const existing = records.get(id);
        if (!existing) {
            return Promise.reject(new RequestNotFoundError(id));
        }
        if (existing.status !== "pending") {
            return Promise.reject(new RequestAlreadyResolvedError(existing.name, id, existing.status));
        }
        try {
            assertPlainObject(response, "Request response must be a plain object");
        } catch (error) {
            return Promise.reject(normalizeError(error));
        }
        const transitioned = transitionToTerminal(id, "responded", {
            respondedAt: Date.now(),
            response,
            responseMetadata: options?.metadata,
        });
        if (!transitioned) {
            const currentStatus = records.get(id)?.status;
            const finalStatus: TerminalRequestStatus =
                currentStatus && isTerminalStatus(currentStatus) ? currentStatus : "responded";
            return Promise.reject(new RequestAlreadyResolvedError(existing.name, id, finalStatus));
        }
        const safe = safelyRedact(transitioned.record, definition);
        bus.emit(
            "request:responded",
            { ...basePayload(safe), response: safe.response, responseMetadata: safe.responseMetadata },
            recordToMeta(safe)
        );
        transitioned.entry.resolve(response);
        return Promise.resolve();
    }

    function reuseExistingByKey<TResponse>(
        idempotencyMapKey: string,
        definitionName: string,
        newSignal: AbortSignal
    ): Promise<TResponse> | undefined {
        const existingId = idempotency.get(idempotencyMapKey);
        if (!existingId) {
            return;
        }
        const existingRecord = records.get(existingId);
        if (!existingRecord) {
            idempotency.delete(idempotencyMapKey);
            return;
        }
        if (existingRecord.status === "responded") {
            return Promise.resolve(existingRecord.response as TResponse);
        }
        if (existingRecord.status === "pending") {
            const entry = pending.get(existingId);
            if (!entry) {
                return;
            }
            return new Promise<TResponse>((resolve, reject) => {
                if (newSignal.aborted) {
                    reject(new RequestCancelledError(definitionName, existingId, "task aborted"));
                    return;
                }
                const onAbort = () => {
                    reject(new RequestCancelledError(definitionName, existingId, "task aborted"));
                };
                newSignal.addEventListener("abort", onAbort, { once: true });
                const detach = () => newSignal.removeEventListener("abort", onAbort);

                const originalResolve = entry.resolve;
                const originalReject = entry.reject;
                entry.resolve = (value) => {
                    originalResolve(value);
                    detach();
                    resolve(value as TResponse);
                };
                entry.reject = (error) => {
                    originalReject(error);
                    detach();
                    reject(error);
                };
            });
        }
        idempotency.delete(idempotencyMapKey);
        return;
    }

    function open<TPayload, TResponse>(args: OpenRequestArgs<TPayload, TResponse>): Promise<TResponse> {
        if (args.options?.timeoutMs !== undefined && args.options.timeoutMs <= 0) {
            throw new FlowEngineError(
                `request "${args.definition.name}": timeoutMs must be > 0 (omit it to wait indefinitely)`
            );
        }
        if (args.signal.aborted) {
            return Promise.reject(new RequestCancelledError(args.definition.name, "<unopened>", "task aborted"));
        }

        const idempotencyMapKey = args.options?.idempotencyKey
            ? computeIdempotencyMapKey({
                  definitionName: args.definition.name,
                  key: args.options.idempotencyKey,
                  path: args.path,
                  runId: args.runId,
              })
            : undefined;

        if (idempotencyMapKey) {
            const reused = reuseExistingByKey<TResponse>(idempotencyMapKey, args.definition.name, args.signal);
            if (reused) {
                return reused;
            }
        }

        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const timeoutAt = args.options?.timeoutMs === undefined ? undefined : createdAt + args.options.timeoutMs;
        const record: AnyRequestRecord = {
            attempt: args.attempt,
            createdAt,
            flowName: args.flowName,
            id,
            idempotencyKey: args.options?.idempotencyKey,
            iteration: args.iteration,
            metadata: args.options?.metadata,
            name: args.definition.name,
            nodeName: args.nodeName,
            path: args.path,
            payload: args.payload,
            runId: args.runId,
            status: "pending",
            timeoutAt,
        };
        records.set(id, record);
        if (idempotencyMapKey) {
            idempotency.set(idempotencyMapKey, id);
        }

        const requestController = new AbortController();
        const taskSignal = args.signal;
        const onAbortTask = () => {
            cancelById(id, "task aborted").catch(() => undefined);
        };
        taskSignal.addEventListener("abort", onAbortTask, { once: true });

        let resolveFn!: (value: unknown) => void;
        let rejectFn!: (error: Error) => void;
        const promise = new Promise<TResponse>((resolve, reject) => {
            resolveFn = resolve as (value: unknown) => void;
            rejectFn = reject;
        });

        const timer =
            args.options?.timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                      expireById(id);
                  }, args.options.timeoutMs);

        const entry: PendingEntry = {
            definition: args.definition,
            onAbortTask,
            reject: rejectFn,
            requestController,
            resolve: resolveFn,
            taskSignal,
            timer,
        };
        pending.set(id, entry);

        const safe = safelyRedact(record, args.definition);
        bus.emit(
            "request:created",
            { ...basePayload(safe), metadata: safe.metadata, payload: safe.payload, timeoutAt: safe.timeoutAt },
            recordToMeta(safe)
        );
        queueMicrotask(() => notifySubscribers(id));

        return promise;
    }

    function subscribe(
        definition: AnyRequestDefinition,
        handler: AnyRequestCreatedHandler,
        options?: RequestSubscribeOptions
    ): RequestSubscription {
        const entry: SubscriberEntry = { definition, handler };
        subscribers.add(entry);

        const replay = options?.replayPending !== false;
        if (replay) {
            for (const [id, pendingEntry] of pending.entries()) {
                if (pendingEntry.definition !== definition) {
                    continue;
                }
                const pendingRequest = buildPendingRequest(id);
                Promise.resolve(handler(pendingRequest)).catch((error: unknown) => {
                    reportSubscriberError(error, definition.name, id);
                });
            }
        }

        return {
            unsubscribe() {
                subscribers.delete(entry);
            },
        };
    }

    function pruneRun(runId: string): void {
        for (const [id, record] of [...records.entries()]) {
            if (record.runId !== runId) {
                continue;
            }
            if (record.status === "pending") {
                cancelById(id, "run ended").catch(() => undefined);
            }
        }
        // Defer the delete so subscribers receiving the cancel/responded events
        // (dispatched via microtask) can still look up the record via engine.requests.get().
        queueMicrotask(() => {
            for (const [id, record] of [...records.entries()]) {
                if (record.runId === runId && record.status !== "pending") {
                    records.delete(id);
                    if (record.idempotencyKey) {
                        const idempotencyMapKey = computeIdempotencyMapKey({
                            definitionName: record.name,
                            key: record.idempotencyKey,
                            path: record.path,
                            runId: record.runId,
                        });
                        idempotency.delete(idempotencyMapKey);
                    }
                }
            }
        });
    }

    return {
        cancel(id: string, reason?: string) {
            return cancelById(id, reason);
        },
        get(id: string) {
            return records.get(id);
        },
        list(filter?: RequestFilter) {
            const result: AnyRequestRecord[] = [];
            for (const record of records.values()) {
                if (matchesFilter(record, filter)) {
                    result.push(record);
                }
            }
            return result;
        },
        on<TPayload, TResponse>(
            definition: RequestDefinition<TPayload, TResponse>,
            handler: (request: PendingRequest<TPayload, TResponse>) => void | Promise<void>,
            options?: RequestSubscribeOptions
        ) {
            return subscribe(definition as AnyRequestDefinition, handler as AnyRequestCreatedHandler, options);
        },
        open,
        pruneRun,
        respond<TPayload, TResponse>(
            definition: RequestDefinition<TPayload, TResponse>,
            id: string,
            response: TResponse,
            options?: RequestResponseOptions
        ) {
            return respondById(definition as AnyRequestDefinition, id, response, options);
        },
    };
}
