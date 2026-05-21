import {
    RequestAlreadyResolvedError,
    RequestCancelledError,
    RequestNotFoundError,
    RequestTimeoutError,
} from "./errors.ts";
import type { InternalBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";
import type {
    AnyPendingRequest,
    AnyRequestCreatedHandler,
    AnyRequestDefinition,
    AnyRequestRecord,
    EngineRequests,
    PendingRequest,
    RequestDefinition,
    RequestFilter,
    RequestOptions,
    RequestResponseOptions,
    RequestSubscribeOptions,
    RequestSubscription,
    TerminalRequestStatus,
} from "./request.ts";
import { isTerminalStatus } from "./request.ts";
import { assertPlainObject } from "./validation.ts";

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

function computeIdempotencyKey(args: {
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

function buildEventBase(record: AnyRequestRecord): {
    dedupeKey?: string;
    flowName: string;
    id: string;
    name: string;
    nodeName?: string;
    path: readonly string[];
    runId: string;
} {
    return {
        dedupeKey: record.dedupeKey,
        flowName: record.flowName,
        id: record.id,
        name: record.name,
        nodeName: record.nodeName,
        path: record.path,
        runId: record.runId,
    };
}

export function createRequestManager(bus: InternalBus<EventMap>): RequestManager {
    const records = new Map<string, AnyRequestRecord>();
    const pending = new Map<string, PendingEntry>();
    const idempotency = new Map<string, string>();
    const subscribers = new Set<SubscriberEntry>();

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
            dedupeKey: record.dedupeKey,
            flowName: record.flowName,
            id: record.id,
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
                console.error(`[RequestManager] subscriber for "${entry.definition.name}" threw:`, error);
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

    type RequestEventTopic = "request:cancelled" | "request:created" | "request:expired" | "request:responded";

    function publishRequestEvent(
        topic: RequestEventTopic,
        record: AnyRequestRecord,
        extras: (record: AnyRequestRecord) => object,
        definition?: AnyRequestDefinition
    ): void {
        const safe = definition ? safelyRedact(record, definition) : record;
        bus.publish(topic, { ...buildEventBase(safe), ...extras(safe) }, { source: "system" }).catch(() => undefined);
    }

    function cancelById(id: string, reason?: string): Promise<void> {
        const existing = records.get(id);
        if (!existing) {
            throw new RequestNotFoundError(id);
        }
        if (existing.status !== "pending") {
            return Promise.resolve();
        }
        const transitioned = transitionToTerminal(id, "cancelled", { cancelledAt: Date.now(), reason });
        if (!transitioned) {
            return Promise.resolve();
        }
        publishRequestEvent("request:cancelled", transitioned.record, (s) => ({ reason: s.reason }));
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
        publishRequestEvent("request:expired", transitioned.record, (s) => ({
            timeoutAt: s.timeoutAt ?? Date.now(),
        }));
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
            throw new RequestNotFoundError(id);
        }
        if (existing.status !== "pending") {
            throw new RequestAlreadyResolvedError(existing.name, id, existing.status);
        }
        assertPlainObject(response, "Request response must be a plain object");
        const transitioned = transitionToTerminal(id, "responded", {
            respondedAt: Date.now(),
            response,
            responseMetadata: options?.metadata,
        });
        if (!transitioned) {
            const currentStatus = records.get(id)?.status;
            const finalStatus: TerminalRequestStatus =
                currentStatus && isTerminalStatus(currentStatus) ? currentStatus : "responded";
            throw new RequestAlreadyResolvedError(existing.name, id, finalStatus);
        }
        publishRequestEvent(
            "request:responded",
            transitioned.record,
            (s) => ({ response: s.response, responseMetadata: s.responseMetadata }),
            definition
        );
        transitioned.entry.resolve(response);
        return Promise.resolve();
    }

    function reuseExistingByKey<TResponse>(idempotencyKey: string): Promise<TResponse> | undefined {
        const existingId = idempotency.get(idempotencyKey);
        if (!existingId) {
            return undefined;
        }
        const existingRecord = records.get(existingId);
        if (!existingRecord) {
            idempotency.delete(idempotencyKey);
            return undefined;
        }
        if (existingRecord.status === "responded") {
            return Promise.resolve(existingRecord.response as TResponse);
        }
        if (existingRecord.status === "pending") {
            const entry = pending.get(existingId);
            if (!entry) {
                return undefined;
            }
            return new Promise<TResponse>((resolve, reject) => {
                const originalResolve = entry.resolve;
                const originalReject = entry.reject;
                entry.resolve = (value) => {
                    originalResolve(value);
                    resolve(value as TResponse);
                };
                entry.reject = (error) => {
                    originalReject(error);
                    reject(error);
                };
            });
        }
        idempotency.delete(idempotencyKey);
        return undefined;
    }

    function open<TPayload, TResponse>(args: OpenRequestArgs<TPayload, TResponse>): Promise<TResponse> {
        if (args.signal.aborted) {
            return Promise.reject(new RequestCancelledError(args.definition.name, "<unopened>", "task aborted"));
        }

        const idempotencyKey = args.options?.dedupeKey
            ? computeIdempotencyKey({
                  definitionName: args.definition.name,
                  key: args.options.dedupeKey,
                  path: args.path,
                  runId: args.runId,
              })
            : undefined;

        if (idempotencyKey) {
            const reused = reuseExistingByKey<TResponse>(idempotencyKey);
            if (reused) {
                return reused;
            }
        }

        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const timeoutAt = args.options?.timeoutMs ? createdAt + args.options.timeoutMs : undefined;
        const record: AnyRequestRecord = {
            attempt: args.attempt,
            createdAt,
            dedupeKey: args.options?.dedupeKey,
            flowName: args.flowName,
            id,
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
        if (idempotencyKey) {
            idempotency.set(idempotencyKey, id);
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

        const timer = args.options?.timeoutMs
            ? setTimeout(() => {
                  expireById(id);
              }, args.options.timeoutMs)
            : undefined;

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

        publishRequestEvent(
            "request:created",
            record,
            (s) => ({ metadata: s.metadata, payload: s.payload, timeoutAt: s.timeoutAt }),
            args.definition
        );
        notifySubscribers(id);

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
                    console.error(`[RequestManager] replay handler for "${definition.name}" threw:`, error);
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
        for (const [id, record] of [...records.entries()]) {
            if (record.runId === runId && record.status !== "pending") {
                records.delete(id);
                if (record.dedupeKey) {
                    const idempotencyKey = computeIdempotencyKey({
                        definitionName: record.name,
                        key: record.dedupeKey,
                        path: record.path,
                        runId: record.runId,
                    });
                    idempotency.delete(idempotencyKey);
                }
            }
        }
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
