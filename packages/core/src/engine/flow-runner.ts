/**
 * engine/flow-runner.ts — Run lifecycle
 *
 * Layer: L4 (engine). Orchestrates a single run: extension setup/teardown, the
 * middleware + node pipeline, pause/cancel, run/flow envelopes, and the result.
 */

import { PauseGate } from "../core/async.ts";
import { normalizeError } from "../core/errors.ts";
import { FlowCancellationSignal } from "../core/signals.ts";
import type { FlowStatus, Outcome, TerminalFlowStatus } from "../core/status.ts";
import { assertPlainObject } from "../core/validation.ts";
import type { AnyExtensionDefinition, ExtensionDispose } from "../definition/extension.ts";
import type { AnyFlowDefinition, FlowDefinition } from "../definition/flow.ts";
import { createEmitMeta, type EmitMeta, type EventBus, resolvePattern } from "../events/bus.ts";
import { createLogger, type Logger } from "../events/logger.ts";
import {
    type AnyEventToken,
    type EmitFn,
    type EmitOptions,
    type EventEnvelope,
    type EventSource,
    type EventSubscriber,
    type EventToken,
    type OnOptions,
    type PayloadOf,
    type Subscription,
    systemEvents,
    type WaitForOptions,
} from "../events/types.ts";
import type { ParamsOf, Shape } from "../shape/shape.ts";
import { createStateStore } from "../state/store.ts";
import type { AnyFlowStateStore } from "../state/types.ts";
import { compose } from "./compose.ts";
import { buildFlowContext, type ExecutionContext, type FlowProgress, type FlowRuntime } from "./context.ts";
import { executeNodes } from "./execute.ts";
import type { RequestManager } from "./request-manager.ts";
import type { AnyFlowResult, FlowResult } from "./results.ts";

// ── Public run handle & contracts ───────────────────────────────────

export interface FlowHandle<TState extends object> {
    cancel(reason?: string): void;
    readonly flowName: string;
    join(): Promise<FlowResult<TState>>;
    pause(): void;
    resume(): void;
    readonly runId: string;
    status(): FlowStatus;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow handle for runtime orchestration
export type AnyFlowHandle = FlowHandle<any>;

export type RunArgs<TParams> = keyof TParams extends never ? [params?: TParams] : [params: TParams];

// biome-ignore lint/suspicious/noExplicitAny: type-erased run arguments, typed at public call boundary
export type AnyRunArgs = [params?: any];

export interface Flow<TParams extends object, TState extends object> {
    name: string;
    run(...args: RunArgs<TParams>): Promise<FlowResult<TState>>;
    start(...args: RunArgs<TParams>): Promise<FlowHandle<TState>>;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow for registries
export type AnyFlow = Flow<any, any>;

export interface FlowRunArgs<TShape extends Shape = Shape> {
    bus: EventBus;
    extensions: readonly AnyExtensionDefinition[];
    flow: FlowDefinition<TShape>;
    params: Readonly<ParamsOf<TShape>>;
    requests: RequestManager;
}

interface ExtensionInstance {
    definition: AnyExtensionDefinition;
    dispose?: ExtensionDispose;
    tracked: Subscription[];
}

interface CancellationState {
    reason?: string;
    requested: boolean;
}

// ── Status helpers ──────────────────────────────────────────────────

function isTerminalFlowStatus(status: FlowStatus): boolean {
    return status === "cancelled" || status === "success" || status === "failed";
}

// ── Extension setup/teardown ────────────────────────────────────────

function buildExtensionSetupContext(args: {
    bus: EventBus;
    definition: AnyExtensionDefinition;
    flowName: string;
    provided: Record<string, unknown>;
    runId: string;
    signal: AbortSignal;
    tracked: Subscription[];
}): Record<string, unknown> {
    const source: EventSource = `extension:${args.definition.name}`;
    const buildMeta = (correlationId?: string): EmitMeta =>
        createEmitMeta(source, { flowName: args.flowName, runId: args.runId }, { correlationId });

    const emit = ((token: AnyEventToken, payload?: unknown, options?: EmitOptions): void => {
        args.bus.emit(token, payload as never, buildMeta(options?.correlationId));
    }) as EmitFn<AnyEventToken>;

    const on: EventSubscriber["on"] = ((
        tokenOrPattern: AnyEventToken | string,
        handler: (event: EventEnvelope) => void | Promise<void>,
        options?: OnOptions
    ): Subscription => {
        const sub = args.bus.on(tokenOrPattern as AnyEventToken, handler, options);
        args.tracked.push(sub);
        return sub;
    }) as EventSubscriber["on"];

    const waitFor: EventSubscriber["waitFor"] = ((
        tokenOrPattern: AnyEventToken | string,
        options?: WaitForOptions
    ): Promise<EventEnvelope> => {
        const topic = resolvePattern(tokenOrPattern);
        const signals: AbortSignal[] = [args.signal];
        if (options?.signal) {
            signals.push(options.signal);
        }
        // A local controller lets run-end teardown settle a still-pending waitFor by
        // aborting it (rejecting the promise and unsubscribing) rather than leaking the
        // underlying subscription. The bus owns filter/timeout/once handling.
        const disposeController = new AbortController();
        signals.push(disposeController.signal);

        const promise = args.bus.waitFor(tokenOrPattern as AnyEventToken, {
            filter: options?.filter,
            signal: AbortSignal.any(signals),
            timeout: options?.timeout,
        });
        args.tracked.push({
            name: `wait_${args.definition.name}_${topic}`,
            topic,
            unsubscribe: () => disposeController.abort(new Error(`waitFor("${topic}") disposed at run end`)),
        });
        return promise;
    }) as EventSubscriber["waitFor"];

    return {
        emit,
        flowName: args.flowName,
        history: (pattern?: string) => args.bus.history(pattern),
        log: createLogger({
            bus: args.bus,
            flowName: args.flowName,
            runId: args.runId,
            source,
        }),
        on,
        provided: args.provided,
        runId: args.runId,
        signal: args.signal,
        waitFor,
    };
}

async function setupExtensions(args: {
    bus: EventBus;
    extensions: readonly AnyExtensionDefinition[];
    flowName: string;
    logger: Logger;
    runId: string;
    signal: AbortSignal;
}): Promise<{ instances: ExtensionInstance[]; provided: Record<string, unknown> }> {
    const instances: ExtensionInstance[] = [];
    const provided: Record<string, unknown> = {};

    try {
        for (const definition of args.extensions) {
            const tracked: Subscription[] = [];
            const instance: ExtensionInstance = { definition, tracked };
            instances.push(instance);
            const setupContext = buildExtensionSetupContext({
                bus: args.bus,
                definition,
                flowName: args.flowName,
                provided: { ...provided },
                runId: args.runId,
                signal: args.signal,
                tracked,
            });
            const result = await definition.setup(setupContext);
            assertPlainObject(result, `Extension "${definition.name}" setup() must return a plain object`);
            if (result.provided !== undefined) {
                assertPlainObject(
                    result.provided,
                    `Extension "${definition.name}" setup() must return { provided } as a plain object`
                );
                Object.assign(provided, result.provided);
            }
            instance.dispose = result.dispose;
        }
    } catch (error) {
        const failure: Outcome = { error: normalizeError(error), status: "failed" };
        await teardownExtensions(instances, failure, args.logger);
        throw error;
    }

    return { instances, provided };
}

async function teardownExtensions(
    instances: readonly ExtensionInstance[],
    outcome: Outcome,
    logger: Logger
): Promise<void> {
    for (const instance of [...instances].reverse()) {
        if (!instance.dispose) {
            continue;
        }
        try {
            await instance.dispose(outcome);
        } catch (error) {
            logger.error(`extension "${instance.definition.name}" dispose failed`, {
                error: normalizeError(error),
            });
        }
    }
    for (const instance of instances) {
        for (const subscription of instance.tracked) {
            subscription.unsubscribe();
        }
        instance.tracked.length = 0;
    }
}

// ── Pipeline ────────────────────────────────────────────────────────

interface PipelineArgs {
    bus: EventBus;
    cancellation: CancellationState;
    controller: AbortController;
    executionContext: ExecutionContext;
    flow: AnyFlowDefinition;
    flowStart: number;
    onPipelineStart: () => void;
    runId: string;
    state: AnyFlowStateStore;
}

interface PipelineOutcome {
    pipelineDurationMs: number;
    result: AnyFlowResult;
}

async function withScope<TPayload>(
    bus: EventBus,
    tokens: { ended: EventToken<TPayload>; started: EventToken<undefined> },
    meta: EmitMeta,
    body: () => Promise<void>,
    toEnded: (durationMs: number, error: unknown) => NoInfer<TPayload>
): Promise<void> {
    const start = Date.now();
    bus.emit(tokens.started, undefined, meta);
    let failure: unknown;
    let failed = false;
    try {
        await body();
    } catch (error) {
        failure = error;
        failed = true;
    }
    bus.emit(tokens.ended, toEnded(Date.now() - start, failed ? failure : undefined), meta);
    if (failed) {
        throw failure;
    }
}

async function runPipeline(args: PipelineArgs): Promise<PipelineOutcome> {
    const { bus, cancellation, controller, executionContext, flow, flowStart, onPipelineStart, runId, state } = args;
    const flowName = flow.name;
    const flowContext = buildFlowContext(executionContext.runtime, state, controller.signal);
    const meta = (): EmitMeta => ({ flowName, runId, source: "runtime" });

    const buildBase = (durationMs: number) => ({
        durationMs,
        flowName,
        runId,
        state: state.snapshot(),
        tasks: executionContext.progress.taskResults,
    });

    try {
        controller.signal.throwIfAborted();
        await compose(flow.middleware, flowContext, () =>
            withScope(
                bus,
                { ended: systemEvents.flow.ended, started: systemEvents.flow.started },
                meta(),
                async () => {
                    onPipelineStart();
                    await executeNodes(flow.nodes, executionContext, state, controller.signal);
                },
                (durationMs, error): PayloadOf<typeof systemEvents.flow.ended> => {
                    if (!error) {
                        return { durationMs, status: "success" };
                    }
                    if (cancellation.requested) {
                        return { durationMs, reason: cancellation.reason, status: "cancelled" };
                    }
                    return { durationMs, error: normalizeError(error), status: "failed" };
                }
            )
        );
        const pipelineDurationMs = Date.now() - flowStart;
        return {
            pipelineDurationMs,
            result: { ...buildBase(pipelineDurationMs), status: "success" },
        };
    } catch (error) {
        const pipelineDurationMs = Date.now() - flowStart;
        if (cancellation.requested) {
            return {
                pipelineDurationMs,
                result: { ...buildBase(pipelineDurationMs), reason: cancellation.reason, status: "cancelled" },
            };
        }
        return {
            pipelineDurationMs,
            result: { ...buildBase(pipelineDurationMs), error: normalizeError(error), status: "failed" },
        };
    }
}

function emitRunEnded(
    bus: EventBus,
    meta: EmitMeta,
    runDurationMs: number,
    status: TerminalFlowStatus,
    detail: { error?: Error; reason?: string }
): void {
    if (status === "success") {
        bus.emit(systemEvents.run.ended, { durationMs: runDurationMs, status: "success" }, meta);
    } else if (status === "cancelled") {
        bus.emit(
            systemEvents.run.ended,
            { durationMs: runDurationMs, reason: detail.reason, status: "cancelled" },
            meta
        );
    } else {
        bus.emit(
            systemEvents.run.ended,
            { durationMs: runDurationMs, error: detail.error ?? new Error("unknown failure"), status: "failed" },
            meta
        );
    }
}

function toOutcome(result: AnyFlowResult): Outcome {
    if (result.status === "cancelled") {
        return { reason: result.reason, status: "cancelled" };
    }
    if (result.status === "failed") {
        return { error: result.error, status: "failed" };
    }
    return { status: "success" };
}

// ── Run entry points ────────────────────────────────────────────────

export async function startFlow<TShape extends Shape>(args: FlowRunArgs<TShape>): Promise<AnyFlowHandle> {
    const { bus, extensions, flow, params, requests } = args;
    const flowName = flow.name;

    assertPlainObject(params, "Flow params must be a plain object");

    const frozenParams = Object.freeze(params);
    const runId = crypto.randomUUID();
    const runStart = Date.now();
    const runtimeLogger: Logger = createLogger({ bus, flowName, runId, source: "runtime" });
    const controller = new AbortController();
    const pauseGate = new PauseGate();
    const runMeta: EmitMeta = { flowName, runId, source: "runtime" };

    bus.emit(systemEvents.run.started, undefined, runMeta);

    let instances: ExtensionInstance[];
    let provided: Record<string, unknown>;
    try {
        const setupResult = await setupExtensions({
            bus,
            extensions,
            flowName,
            logger: runtimeLogger,
            runId,
            signal: controller.signal,
        });
        instances = setupResult.instances;
        provided = setupResult.provided;
    } catch (setupError) {
        const normalized = normalizeError(setupError);
        emitRunEnded(bus, runMeta, Date.now() - runStart, "failed", { error: normalized });
        throw setupError;
    }

    const initialState = flow.state ? flow.state(frozenParams) : {};
    const state = createStateStore(initialState);
    const progress: FlowProgress = { taskResults: [] };

    const runtime: FlowRuntime = {
        bus,
        flowName,
        log: runtimeLogger,
        params: frozenParams,
        provided,
        requests,
        runId,
    };

    const executionContext: ExecutionContext = {
        pathSegments: [],
        pauseGate,
        progress,
        runtime,
    };

    let currentStatus: FlowStatus = "pending";
    let pendingPause = false;
    const cancellation: CancellationState = { requested: false };
    const pipelineStart = Date.now();

    const applyPause = () => {
        currentStatus = "paused";
        pauseGate.pause();
        bus.emit(systemEvents.flow.paused, undefined, runMeta);
    };

    const pipelinePromise = runPipeline({
        bus,
        cancellation,
        controller,
        executionContext,
        flow,
        flowStart: pipelineStart,
        onPipelineStart: () => {
            if (!isTerminalFlowStatus(currentStatus)) {
                currentStatus = "running";
                if (pendingPause) {
                    pendingPause = false;
                    applyPause();
                }
            }
        },
        runId,
        state,
    }).then(async (pipelineOutcome) => {
        const { result } = pipelineOutcome;

        if (!isTerminalFlowStatus(currentStatus)) {
            currentStatus = result.status;
        }

        requests.pruneRun(runId);

        await teardownExtensions(instances, toOutcome(result), runtimeLogger);

        emitRunEnded(bus, runMeta, Date.now() - runStart, result.status, {
            error: result.status === "failed" ? result.error : undefined,
            reason: result.status === "cancelled" ? result.reason : undefined,
        });

        return result;
    });

    return {
        cancel(reason?: string) {
            if (isTerminalFlowStatus(currentStatus)) {
                return;
            }
            cancellation.requested = true;
            cancellation.reason = reason;
            currentStatus = "cancelled";
            pauseGate.resume();
            controller.abort(new FlowCancellationSignal(reason));
        },
        flowName,
        join() {
            return pipelinePromise;
        },
        pause() {
            // A pause requested before the pipeline starts (status "pending") is queued
            // and applied at flow:started, rather than being silently dropped.
            if (currentStatus === "pending") {
                pendingPause = true;
                return;
            }
            if (currentStatus !== "running") {
                return;
            }
            applyPause();
        },
        resume() {
            if (currentStatus === "pending") {
                pendingPause = false;
                return;
            }
            if (currentStatus !== "paused") {
                return;
            }
            currentStatus = "running";
            pauseGate.resume();
            bus.emit(systemEvents.flow.resumed, undefined, runMeta);
        },
        runId,
        status() {
            return currentStatus;
        },
    };
}

export async function runFlow<TShape extends Shape>(args: FlowRunArgs<TShape>): Promise<AnyFlowResult> {
    const handle = await startFlow(args);
    return handle.join();
}
