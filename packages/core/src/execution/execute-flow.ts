import { coreContextKeys } from "../core/constants.ts";
import { FlowEngineError } from "../core/errors.ts";
import type {
    AnyExtension,
    CompletedResult,
    EventMap,
    Extension,
    FlowInfo,
    Middleware,
    RunResult,
    StateShape,
    TaskRunResult,
    UserEmitEventMap,
    UserEventMap,
} from "../core/types.ts";
import type { RunController } from "../engine/run-controller.ts";
import type { EventBus } from "../events/event-bus.ts";
import { FlowStateStore } from "../state/state-store.ts";
import { cloneValue } from "../utils/clone.ts";
import { getDurationMs } from "../utils/time.ts";
import { createFlowContext } from "./context-factory.ts";
import { executeNodes } from "./execute-nodes.ts";
import type { ExecutionContext } from "./execution-types.ts";
import type { ResolvedFlowPlan } from "./resolver.ts";

// ── Extension helpers ────────────────────────────────────────────────

interface ExtensionRecord {
    readonly context: object;
    readonly definition: Extension<object, UserEventMap>;
}

export interface ExecuteFlowOptions<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
> {
    readonly eventBus: EventBus<EventMap>;
    readonly extensions: readonly AnyExtension[];
    readonly params: TParams;
    readonly plan: ResolvedFlowPlan<TParams, TState, TUserEvents, TBaseContext, object>;
    readonly runController: RunController;
    readonly runId: string;
}

const normalizeError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const createInitialState = <TState extends StateShape>(
    initialState: TState | (() => TState) | undefined
): Partial<TState> => {
    if (initialState === undefined) {
        return {};
    }

    const resolved = typeof initialState === "function" ? initialState() : initialState;
    return cloneValue(resolved);
};

const mergeExtensionContext = (target: Record<string, unknown>, extensionContext: object): void => {
    if (Array.isArray(extensionContext) || extensionContext === null) {
        throw new FlowEngineError("Extension context must be an object");
    }

    for (const key of Object.keys(extensionContext)) {
        if (coreContextKeys.includes(key as (typeof coreContextKeys)[number])) {
            throw new FlowEngineError(`Extension context key "${key}" collides with a core context property`);
        }

        if (key in target) {
            throw new FlowEngineError(`Extension context key "${key}" collides with another extension`);
        }

        target[key] = (extensionContext as Record<string, unknown>)[key];
    }
};

const createRunResult = <TState extends StateShape>(
    flowInfo: FlowInfo,
    runId: string,
    stateStore: FlowStateStore<TState>,
    taskResults: readonly TaskRunResult[],
    durationMs: number,
    status: "cancelled" | "completed" | "failed",
    error: Error | undefined,
    stopReason: string | undefined,
    cancelReason: string | undefined
): RunResult<TState> => {
    const base = {
        durationMs,
        flowId: flowInfo.id,
        flowName: flowInfo.name,
        runId,
        state: stateStore.snapshot(),
        tasks: taskResults,
    };

    if (status === "completed") {
        return { ...base, status, stopReason };
    }

    if (status === "cancelled") {
        return { ...base, cancelReason, status, stopReason };
    }

    return {
        ...base,
        error: error ?? new Error("Flow execution failed"),
        status,
        stopReason,
    };
};

const createExtensionInstances = async (
    extensions: readonly AnyExtension[],
    flowInfo: FlowInfo,
    params: unknown,
    runId: string,
    signal: AbortSignal,
    eventBus: EventBus<EventMap>
): Promise<{ extensionContext: Record<string, unknown>; records: ExtensionRecord[] }> => {
    const extensionContext: Record<string, unknown> = {};
    const records: ExtensionRecord[] = [];

    for (const extension of extensions) {
        const ctx = await extension.create({
            emit: (type: string, data: Record<string, unknown>) => {
                eventBus.dispatch({ flowId: flowInfo.id, payload: data, runId, type });
            },
            flow: flowInfo,
            params,
            runId,
            signal,
        } as any);

        records.push({ context: ctx, definition: extension });
        mergeExtensionContext(extensionContext, ctx);
    }

    return { extensionContext, records };
};

const disposeExtensions = async (
    records: readonly ExtensionRecord[],
    logInternal: (message: string, data?: unknown) => void
): Promise<void> => {
    for (const record of [...records].reverse()) {
        if (record.definition.dispose === undefined) {
            continue;
        }

        try {
            await record.definition.dispose(record.context);
        } catch (error) {
            logInternal("Extension dispose failed", { error: normalizeError(error) });
        }
    }
};

// ── Main execution ──────────────────────────────────────────────────

export const executeFlow = async <
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
>(
    options: ExecuteFlowOptions<TParams, TState, TUserEvents, TBaseContext>
): Promise<RunResult<TState>> => {
    const startTime = performance.now();
    const flowInfo: FlowInfo = {
        id: options.plan.flow.id,
        name: options.plan.flow.name,
    };
    const stateStore = new FlowStateStore<TState>(createInitialState(options.plan.flow.initialState));
    const taskResults: TaskRunResult[] = [];

    let extensionContext = {} as TBaseContext;
    let extensionRecords: readonly ExtensionRecord[] = [];
    let finalError: Error | undefined;
    let finalStatus: "cancelled" | "completed" | "failed" = "completed";

    const logInternal = (message: string, data?: unknown): void => {
        options.eventBus.dispatch({
            flowId: flowInfo.id,
            payload: { data, level: "error", message },
            runId: options.runId,
            type: "log",
        });
    };

    const emitUserEvent = <TType extends keyof UserEmitEventMap<TUserEvents> & string>(
        type: TType,
        data: UserEmitEventMap<TUserEvents>[TType]
    ): void => {
        options.eventBus.dispatch({
            flowId: flowInfo.id,
            payload: data as Record<string, unknown>,
            runId: options.runId,
            type,
        });
    };

    try {
        const created = await createExtensionInstances(
            options.extensions,
            flowInfo,
            options.params,
            options.runId,
            options.runController.signal,
            options.eventBus
        );

        extensionContext = created.extensionContext as TBaseContext;
        extensionRecords = created.records;

        const flowContext = createFlowContext({
            emit: emitUserEvent,
            flow: flowInfo,
            params: options.params,
            runId: options.runId,
            signal: options.runController.signal,
            state: stateStore,
            stop: (reason) => options.runController.requestStop(reason),
            userContext: extensionContext,
        });

        options.eventBus.dispatch({
            flowId: flowInfo.id,
            payload: { flowName: flowInfo.name, params: options.params },
            runId: options.runId,
            type: "flow.started",
        });

        try {
            if (options.plan.flow.hooks.onStart !== undefined) {
                await options.plan.flow.hooks.onStart(flowContext as any);
            }

            if (!(options.runController.isCancelled || options.runController.isStopped)) {
                const executionContext: ExecutionContext<TParams, TState, TUserEvents, TBaseContext> = {
                    eventBus: options.eventBus,
                    emitUserEvent,
                    flowInfo,
                    flowMiddleware: options.plan.flow.middleware as readonly Middleware<
                        TParams,
                        TState,
                        TBaseContext,
                        TUserEvents
                    >[],
                    params: options.params,
                    runController: options.runController,
                    runId: options.runId,
                    scopedContext: extensionContext,
                    signal: options.runController.signal,
                    stateStore,
                    taskResults,
                };

                const outcome = await executeNodes(executionContext, options.plan.nodes);

                if (outcome.error !== undefined) {
                    throw outcome.error;
                }
            }

            finalStatus = options.runController.isCancelled ? "cancelled" : "completed";

            if (finalStatus === "completed" && options.plan.flow.hooks.onSuccess !== undefined) {
                const successResult = createRunResult(
                    flowInfo,
                    options.runId,
                    stateStore,
                    taskResults,
                    getDurationMs(startTime),
                    "completed",
                    undefined,
                    options.runController.stopReason,
                    options.runController.cancelReason
                ) as CompletedResult<TState>;

                await options.plan.flow.hooks.onSuccess(flowContext as any, successResult);
            }
        } catch (error) {
            finalError = normalizeError(error);
            finalStatus =
                options.runController.isCancelled && finalError.name === "AbortError" ? "cancelled" : "failed";

            if (finalStatus === "failed" && options.plan.flow.hooks.onFailure !== undefined) {
                try {
                    await options.plan.flow.hooks.onFailure(flowContext as any, finalError);
                } catch (hookError) {
                    logInternal("Flow failure hook failed", {
                        error: normalizeError(hookError),
                    });
                }
            }
        }

        const result = createRunResult(
            flowInfo,
            options.runId,
            stateStore,
            taskResults,
            getDurationMs(startTime),
            finalStatus,
            finalStatus === "failed" ? finalError : undefined,
            options.runController.stopReason,
            options.runController.cancelReason
        );

        options.eventBus.dispatch({
            flowId: flowInfo.id,
            payload: {
                cancelReason: result.status === "cancelled" ? result.cancelReason : undefined,
                durationMs: result.durationMs,
                error: result.status === "failed" ? result.error : undefined,
                flowName: flowInfo.name,
                status: result.status,
                stopReason: result.stopReason,
            },
            runId: options.runId,
            type: "flow.ended",
        });

        if (options.plan.flow.hooks.onComplete !== undefined) {
            try {
                await options.plan.flow.hooks.onComplete(flowContext as any, result);
            } catch (hookError) {
                logInternal("Flow completion hook failed", {
                    error: normalizeError(hookError),
                });
            }
        }

        options.runController.setTerminalStatus(result.status);
        return result;
    } catch (error) {
        finalError = normalizeError(error);
        finalStatus = options.runController.isCancelled && finalError.name === "AbortError" ? "cancelled" : "failed";

        const result = createRunResult(
            flowInfo,
            options.runId,
            stateStore,
            taskResults,
            getDurationMs(startTime),
            finalStatus,
            finalStatus === "failed" ? finalError : undefined,
            options.runController.stopReason,
            options.runController.cancelReason
        );

        options.eventBus.dispatch({
            flowId: flowInfo.id,
            payload: {
                cancelReason: result.status === "cancelled" ? result.cancelReason : undefined,
                durationMs: result.durationMs,
                error: result.status === "failed" ? result.error : undefined,
                flowName: flowInfo.name,
                status: result.status,
                stopReason: result.stopReason,
            },
            runId: options.runId,
            type: "flow.ended",
        });

        options.runController.setTerminalStatus(result.status);
        return result;
    } finally {
        await disposeExtensions(extensionRecords, logInternal);
    }
};
