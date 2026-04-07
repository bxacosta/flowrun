import type { ExecutionContext, FlowProgress, FlowRuntime } from "./context.ts";
import { buildFlowContext } from "./context.ts";
import { normalizeError } from "./errors.ts";
import type { InternalBus, PublishableBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";
import { executeNodes } from "./execute.ts";
import type { AnyExtension, ExtensionContext } from "./extension.ts";
import { buildLogger } from "./logger.ts";
import { compose } from "./middleware.ts";
import { PauseGate } from "./signal.ts";
import { createStateStore } from "./state.ts";
import type {
    AnyFlowHandle,
    AnyFlowResult,
    AnyFlowStateStore,
    AnyScope,
    FlowDefinition,
    FlowStatus,
    NodeDefinition,
} from "./types.ts";
import { assertPlainObject } from "./validation.ts";

// ── Internal Types ────────────────────────────────────────────────────

interface ExtensionInstance {
    extension: AnyExtension;
    provided: object;
}

interface CancellationState {
    reason?: string;
    requested: boolean;
}

export interface FlowRunArgs<TScope extends AnyScope = AnyScope> {
    bus: InternalBus<EventMap>;
    definition: FlowDefinition<TScope>;
    extensions: readonly AnyExtension[];
    flowId: string;
    nodes: readonly NodeDefinition[];
    params: Readonly<TScope["_params"]>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function isTerminalStatus(status: FlowStatus): boolean {
    return status === "cancelled" || status === "completed" || status === "failed";
}

// ── Extension Lifecycle ──────────────────────────────────────────────

async function disposeExtensions(instances: readonly ExtensionInstance[]): Promise<void> {
    for (const { extension, provided } of [...instances].reverse()) {
        await extension.dispose?.(provided);
    }
}

async function createExtensions(
    extensions: readonly AnyExtension[],
    context: ExtensionContext<EventMap>
): Promise<{ instances: ExtensionInstance[]; provided: Record<string, unknown> }> {
    const instances: ExtensionInstance[] = [];
    const provided: Record<string, unknown> = {};

    try {
        for (const extension of extensions) {
            const result = extension.create(context);
            assertPlainObject(
                result,
                `Extension "${extension.name}" must return a plain object from create(), not an array or function`
            );
            Object.assign(provided, result);
            instances.push({ extension, provided: result });
        }
    } catch (createError) {
        await disposeExtensions(instances);
        throw createError;
    }

    return { instances, provided };
}

// ── Pipeline ─────────────────────────────────────────────────────────

interface PipelineArgs<TScope extends AnyScope = AnyScope> {
    bus: InternalBus<EventMap>;
    cancellation: CancellationState;
    controller: AbortController;
    definition: FlowDefinition<TScope>;
    executionContext: ExecutionContext;
    flowId: string;
    flowStart: number;
    nodes: readonly NodeDefinition[];
    runId: string;
    state: AnyFlowStateStore;
}

async function runFlowPipeline<TScope extends AnyScope>(args: PipelineArgs<TScope>): Promise<AnyFlowResult> {
    const { bus, cancellation, controller, definition, executionContext, flowId, flowStart, nodes, runId, state } =
        args;
    const flowMiddleware = definition.middleware ?? [];
    const flowContext = buildFlowContext(executionContext.runtime, state, controller.signal);

    const resultBase = () => ({
        duration: Date.now() - flowStart,
        flowId,
        runId,
        state: state.snapshot(),
        tasks: executionContext.progress.taskResults,
    });

    let flowStarted = false;

    try {
        controller.signal.throwIfAborted();

        await compose(flowMiddleware, flowContext, async () => {
            flowStarted = true;
            await bus.publish("flow:start", { flowId, runId }, { source: "system" });
            await executeNodes(nodes, executionContext, state, controller.signal);
        });

        if (flowStarted) {
            await bus.publish(
                "flow:end",
                { duration: Date.now() - flowStart, flowId, runId, status: "success" },
                { source: "system" }
            );
        }

        return { ...resultBase(), status: "success" } as AnyFlowResult;
    } catch (error) {
        if (cancellation.requested) {
            if (flowStarted) {
                await bus.publish(
                    "flow:end",
                    {
                        duration: Date.now() - flowStart,
                        flowId,
                        reason: cancellation.reason,
                        runId,
                        status: "cancelled",
                    },
                    { source: "system" }
                );
            }
            return { ...resultBase(), reason: cancellation.reason, status: "cancelled" } as AnyFlowResult;
        }

        controller.abort();
        const failedError = normalizeError(error);
        if (flowStarted) {
            await bus.publish(
                "flow:end",
                { duration: Date.now() - flowStart, error: failedError, flowId, runId, status: "failed" },
                { source: "system" }
            );
        }
        return { ...resultBase(), error: failedError, status: "failed" } as AnyFlowResult;
    }
}

// ── Start Orchestrator ──────────────────────────────────────────────

export async function startFlow<TScope extends AnyScope>(args: FlowRunArgs<TScope>): Promise<AnyFlowHandle> {
    const { bus, definition, extensions, flowId, nodes, params } = args;

    assertPlainObject(params, "Flow params must be a plain object, not an array or function");
    const frozenParams = Object.freeze(params);
    const runId = crypto.randomUUID();
    const flowStart = Date.now();
    const initialState = definition.state ? definition.state(frozenParams) : {};
    const state = createStateStore(initialState);
    const logger = buildLogger(flowId, runId, bus);

    const extensionContext: ExtensionContext<EventMap> = {
        bus,
        flowId,
        log: logger,
        runId,
    };

    const { instances, provided } = await createExtensions(extensions, extensionContext);

    const publicBus: PublishableBus<EventMap, EventMap> = bus.narrow();
    const controller = new AbortController();
    const pauseGate = new PauseGate();

    const runtime: FlowRuntime = {
        bus,
        flowId,
        log: logger,
        params: frozenParams,
        provided,
        publicBus,
        runId,
    };

    const progress: FlowProgress = { taskResults: [] };

    const executionContext: ExecutionContext = {
        pauseGate,
        pathSegments: [],
        progress,
        runtime,
    };

    let currentStatus: FlowStatus = "running";
    const cancellation: CancellationState = { requested: false };

    const pipelinePromise = runFlowPipeline({
        bus,
        cancellation,
        controller,
        definition,
        executionContext,
        flowId,
        flowStart,
        nodes,
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
            return result;
        })
        .finally(() =>
            disposeExtensions(instances).catch(() => {
                /* cleanup errors are non-fatal */
            })
        );

    return {
        flowId,
        runId,
        cancel(reason?: string) {
            if (isTerminalStatus(currentStatus)) {
                return;
            }
            cancellation.requested = true;
            cancellation.reason = reason;
            currentStatus = "cancelled";
            pauseGate.resume();
            controller.abort();
        },
        join() {
            return pipelinePromise;
        },
        pause() {
            if (currentStatus !== "running") {
                return;
            }
            currentStatus = "paused";
            pauseGate.pause();
            bus.publish("flow:paused", { flowId, runId }, { source: "system" });
        },
        resume() {
            if (currentStatus !== "paused") {
                return;
            }
            currentStatus = "running";
            pauseGate.resume();
            bus.publish("flow:resumed", { flowId, runId }, { source: "system" });
        },
        status() {
            return currentStatus;
        },
    };
}

// ── Run (sugar) ─────────────────────────────────────────────────────

export async function runFlow<TScope extends AnyScope>(args: FlowRunArgs<TScope>): Promise<AnyFlowResult> {
    const handle = await startFlow(args);
    return handle.join();
}
