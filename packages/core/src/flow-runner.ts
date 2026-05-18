import type { ExecutionContext, FlowProgress, FlowRuntime } from "./context.ts";
import { buildFlowContext } from "./context.ts";
import { normalizeError } from "./errors.ts";
import type { InternalBus, PublishableBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";
import { executeNodes } from "./execute.ts";
import type { AnyExtensionDefinition, ExtensionCleanup, FlowOutcome } from "./extension.ts";
import { createLogger } from "./logger.ts";
import type { AnyMiddleware } from "./middleware.ts";
import { compose } from "./middleware.ts";
import type { AnyStateFactory, NodeDefinition, TaskResult } from "./node.ts";
import type { RequestManager } from "./request-manager.ts";
import type { AnyScope } from "./scope.ts";
import { PauseGate } from "./signal.ts";
import type { AnyFlowStateStore } from "./state.ts";
import { createStateStore } from "./state.ts";
import { assertPlainObject } from "./validation.ts";

export interface FlowDefinition<TScope extends AnyScope = AnyScope> {
    readonly _scope?: TScope;
    readonly kind: "flow";
    readonly middleware: readonly AnyMiddleware[];
    readonly name: string;
    readonly nodes: readonly NodeDefinition[];
    readonly state?: AnyStateFactory;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow definition for registries
export type AnyFlowDefinition = FlowDefinition<any>;

export type FlowStatus = "cancelled" | "completed" | "failed" | "paused" | "running";

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

export interface BaseFlowResult<TState extends object> {
    duration: number;
    flowName: string;
    runId: string;
    state: Readonly<TState>;
    tasks: readonly TaskResult[];
}

export interface SuccessFlowResult<TState extends object> extends BaseFlowResult<TState> {
    status: "success";
}

export interface FailedFlowResult<TState extends object> extends BaseFlowResult<TState> {
    error: Error;
    status: "failed";
}

export interface CancelledFlowResult<TState extends object> extends BaseFlowResult<TState> {
    reason?: string;
    status: "cancelled";
}

export type FlowResult<TState extends object> =
    | CancelledFlowResult<TState>
    | FailedFlowResult<TState>
    | SuccessFlowResult<TState>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow result for runtime orchestration
export type AnyFlowResult = FlowResult<any>;

interface ExtensionInstance {
    cleanup?: ExtensionCleanup;
    extension: AnyExtensionDefinition;
}

interface CancellationState {
    reason?: string;
    requested: boolean;
}

interface ExtensionSetupBaseContext {
    bus: InternalBus<EventMap>;
    flowName: string;
    log: ReturnType<typeof createLogger>;
    runId: string;
    signal: AbortSignal;
}

export interface FlowRunArgs<TScope extends AnyScope = AnyScope> {
    bus: InternalBus<EventMap>;
    extensions: readonly AnyExtensionDefinition[];
    flow: FlowDefinition<TScope>;
    params: Readonly<TScope["_params"]>;
    requests: RequestManager;
}

function isTerminalStatus(status: FlowStatus): boolean {
    return status === "cancelled" || status === "completed" || status === "failed";
}

async function cleanupExtensions(instances: readonly ExtensionInstance[], outcome: FlowOutcome): Promise<void> {
    for (const { cleanup } of [...instances].reverse()) {
        if (!cleanup) {
            continue;
        }
        await cleanup(outcome);
    }
}

async function provideExtensions(
    extensions: readonly AnyExtensionDefinition[],
    baseContext: ExtensionSetupBaseContext
): Promise<{ instances: ExtensionInstance[]; provided: Record<string, unknown> }> {
    const instances: ExtensionInstance[] = [];
    const provided: Record<string, unknown> = {};

    try {
        for (const extension of extensions) {
            const result = await extension.resource.provide(baseContext);
            assertPlainObject(result, `Extension "${extension.name}" provide() must return a plain object`);
            assertPlainObject(
                result.provided,
                `Extension "${extension.name}" provide() must return { provided } as a plain object`
            );
            Object.assign(provided, result.provided);
            instances.push({ cleanup: result.cleanup, extension });
        }
    } catch (error) {
        const failure: FlowOutcome = { error: normalizeError(error), status: "failed" };
        await cleanupExtensions(instances, failure);
        throw error;
    }

    return { instances, provided };
}

interface PipelineArgs {
    bus: InternalBus<EventMap>;
    cancellation: CancellationState;
    controller: AbortController;
    executionContext: ExecutionContext;
    flow: AnyFlowDefinition;
    flowStart: number;
    runId: string;
    state: AnyFlowStateStore;
}

async function runPipeline(args: PipelineArgs): Promise<AnyFlowResult> {
    const { bus, cancellation, controller, executionContext, flow, flowStart, runId, state } = args;
    const flowName = flow.name;
    const flowContext = buildFlowContext(executionContext.runtime, state, controller.signal);
    let flowStarted = false;

    const resultBase = () => ({
        duration: Date.now() - flowStart,
        flowName,
        runId,
        state: state.snapshot(),
        tasks: executionContext.progress.taskResults,
    });

    try {
        controller.signal.throwIfAborted();
        await compose(flow.middleware, flowContext, async () => {
            flowStarted = true;
            await bus.publish("flow:started", { flowName, runId }, { source: "system" });
            await executeNodes(flow.nodes, executionContext, state, controller.signal);
        });

        if (flowStarted) {
            await bus.publish(
                "flow:ended",
                { duration: Date.now() - flowStart, flowName, runId, status: "success" },
                { source: "system" }
            );
        }

        return { ...resultBase(), status: "success" };
    } catch (error) {
        if (cancellation.requested) {
            if (flowStarted) {
                await bus.publish(
                    "flow:ended",
                    {
                        duration: Date.now() - flowStart,
                        flowName,
                        reason: cancellation.reason,
                        runId,
                        status: "cancelled",
                    },
                    { source: "system" }
                );
            }
            return { ...resultBase(), reason: cancellation.reason, status: "cancelled" };
        }

        controller.abort(error);
        const normalized = normalizeError(error);
        if (flowStarted) {
            await bus.publish(
                "flow:ended",
                { duration: Date.now() - flowStart, error: normalized, flowName, runId, status: "failed" },
                { source: "system" }
            );
        }
        return { ...resultBase(), error: normalized, status: "failed" };
    }
}

export async function startFlow<TScope extends AnyScope>(args: FlowRunArgs<TScope>): Promise<AnyFlowHandle> {
    const { bus, extensions, flow, params, requests } = args;
    const flowName = flow.name;

    assertPlainObject(params, "Flow params must be a plain object");

    const frozenParams = Object.freeze(params);
    const runId = crypto.randomUUID();
    const flowStart = Date.now();
    const logger = createLogger(flowName, runId, bus);
    const controller = new AbortController();
    const pauseGate = new PauseGate();
    const extensionContext: ExtensionSetupBaseContext = {
        bus,
        flowName,
        log: logger,
        runId,
        signal: controller.signal,
    };
    const { instances, provided } = await provideExtensions(extensions, extensionContext);
    const initialState = flow.state ? flow.state(frozenParams) : {};
    const state = createStateStore(initialState);
    const publicBus: PublishableBus<EventMap, EventMap> = bus.narrow();
    const progress: FlowProgress = { taskResults: [] };

    const runtime: FlowRuntime = {
        bus,
        flowName,
        log: logger,
        params: frozenParams,
        provided,
        publicBus,
        requests,
        runId,
    };

    const executionContext: ExecutionContext = {
        pathSegments: [],
        pauseGate,
        progress,
        runtime,
    };

    let currentStatus: FlowStatus = "running";
    const cancellation: CancellationState = { requested: false };
    let cleanupOutcome: FlowOutcome = { status: "success" };

    const pipelinePromise = runPipeline({
        bus,
        cancellation,
        controller,
        executionContext,
        flow,
        flowStart,
        runId,
        state,
    })
        .then((result) => {
            if (!isTerminalStatus(currentStatus)) {
                if (result.status === "cancelled") {
                    currentStatus = "cancelled";
                } else if (result.status === "failed") {
                    currentStatus = "failed";
                } else {
                    currentStatus = "completed";
                }
            }
            cleanupOutcome = toCleanupOutcome(result);
            return result;
        })
        .finally(async () => {
            requests.pruneRun(runId);
            try {
                return await cleanupExtensions(instances, cleanupOutcome);
            } catch (error) {
                logger.error("extension cleanup failed", { error });
            }
        });

    return {
        cancel(reason?: string) {
            if (isTerminalStatus(currentStatus)) {
                return;
            }
            cancellation.requested = true;
            cancellation.reason = reason;
            currentStatus = "cancelled";
            pauseGate.resume();
            controller.abort(reason ? new Error(reason) : undefined);
        },
        flowName,
        join() {
            return pipelinePromise;
        },
        pause() {
            if (currentStatus !== "running") {
                return;
            }
            currentStatus = "paused";
            pauseGate.pause();
            bus.publish("flow:paused", { flowName, runId }, { source: "system" });
        },
        resume() {
            if (currentStatus !== "paused") {
                return;
            }
            currentStatus = "running";
            pauseGate.resume();
            bus.publish("flow:resumed", { flowName, runId }, { source: "system" });
        },
        runId,
        status() {
            return currentStatus;
        },
    };
}

export async function runFlow<TScope extends AnyScope>(args: FlowRunArgs<TScope>): Promise<AnyFlowResult> {
    const handle = await startFlow(args);
    return handle.join();
}

function toCleanupOutcome(result: AnyFlowResult): FlowOutcome {
    if (result.status === "cancelled") {
        return { reason: result.reason, status: "cancelled" };
    }
    if (result.status === "failed") {
        return { error: result.error, status: "failed" };
    }
    return { status: "success" };
}
