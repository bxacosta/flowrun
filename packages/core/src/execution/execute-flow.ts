import { coreContextKeys } from "../core/constants.ts";
import { FlowEngineError } from "../core/errors.ts";
import type {
    CompletedResult,
    EventMap,
    FlowInfo,
    LogEvent,
    Logger,
    RunResult,
    ServiceFactory,
    ServiceFactoryApi,
    StateShape,
    TaskRunResult,
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

// ── Service helpers ─────────────────────────────────────────────────

export interface ExecuteFlowOptions {
    readonly eventBus: EventBus<EventMap>;
    readonly params: unknown;
    readonly plan: ResolvedFlowPlan;
    readonly runController: RunController;
    readonly runId: string;
    readonly service?: ServiceFactory<object>;
}

const normalizeError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const createInitialState = (initialState: StateShape | (() => StateShape) | undefined): Partial<StateShape> => {
    if (initialState === undefined) {
        return {};
    }

    const resolved = typeof initialState === "function" ? initialState() : initialState;
    return cloneValue(resolved);
};

const validateServiceContext = (context: object): void => {
    if (Array.isArray(context) || context === null) {
        throw new FlowEngineError("Service context must be an object");
    }

    for (const key of Object.keys(context)) {
        if (coreContextKeys.includes(key as (typeof coreContextKeys)[number])) {
            throw new FlowEngineError(`Service context key "${key}" collides with a core context property`);
        }
    }
};

const createRunResult = (
    flowInfo: FlowInfo,
    runId: string,
    stateStore: FlowStateStore<StateShape>,
    taskResults: readonly TaskRunResult[],
    durationMs: number,
    status: "cancelled" | "completed" | "failed",
    error: Error | undefined,
    stopReason: string | undefined,
    cancelReason: string | undefined
): RunResult<StateShape> => {
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

const createServiceFactoryApi = (
    flowInfo: FlowInfo,
    params: unknown,
    runId: string,
    signal: AbortSignal,
    eventBus: EventBus<EventMap>
): ServiceFactoryApi => {
    const emit = (type: string, data: Record<string, unknown>): void => {
        eventBus.dispatch({ flowId: flowInfo.id, payload: data, runId, type });
    };

    const emitLog = (payload: LogEvent): void => {
        eventBus.dispatch({
            flowId: flowInfo.id,
            payload: payload as unknown as Record<string, unknown>,
            runId,
            type: "log",
        });
    };

    const log: Logger = {
        debug: (message, data) => emitLog({ data, level: "debug", message }),
        error: (message, data) => emitLog({ data, level: "error", message }),
        info: (message, data) => emitLog({ data, level: "info", message }),
        warn: (message, data) => emitLog({ data, level: "warn", message }),
    };

    return { emit, flow: flowInfo, log, params, runId, signal };
};

const createServiceContext = async (
    service: ServiceFactory<object> | undefined,
    api: ServiceFactoryApi
): Promise<object> => {
    if (service === undefined) {
        return {};
    }

    const context = await service.create(api);
    validateServiceContext(context);
    return context;
};

const disposeService = async (
    service: ServiceFactory<object> | undefined,
    context: object,
    api: ServiceFactoryApi,
    logInternal: (message: string, data?: unknown) => void
): Promise<void> => {
    if (service === undefined || service.dispose === undefined) {
        return;
    }

    try {
        await service.dispose(context, api);
    } catch (error) {
        logInternal("Service dispose failed", { error: normalizeError(error) });
    }
};

// ── Main execution ──────────────────────────────────────────────────

export const executeFlow = async (options: ExecuteFlowOptions): Promise<RunResult<StateShape>> => {
    const startTime = performance.now();
    const flowInfo: FlowInfo = {
        id: options.plan.flow.id,
        name: options.plan.flow.name,
    };
    const stateStore = new FlowStateStore<StateShape>(createInitialState(options.plan.flow.initialState));
    const taskResults: TaskRunResult[] = [];

    let serviceContext: object = {};
    let finalError: Error | undefined;
    let finalStatus: "cancelled" | "completed" | "failed" = "completed";

    const logInternal = (message: string, data?: unknown): void => {
        options.eventBus.dispatch({
            flowId: flowInfo.id,
            payload: { data, level: "error", message } as unknown as Record<string, unknown>,
            runId: options.runId,
            type: "log",
        });
    };

    const emitUserEvent = (type: string, data: Record<string, unknown>): void => {
        options.eventBus.dispatch({
            flowId: flowInfo.id,
            payload: data,
            runId: options.runId,
            type,
        });
    };

    const serviceApi = createServiceFactoryApi(
        flowInfo,
        options.params,
        options.runId,
        options.runController.signal,
        options.eventBus
    );

    try {
        serviceContext = await createServiceContext(options.service, serviceApi);

        const flowContext = createFlowContext({
            emit: emitUserEvent,
            flow: flowInfo,
            params: options.params,
            runId: options.runId,
            signal: options.runController.signal,
            state: stateStore,
            stop: (reason) => options.runController.requestStop(reason),
            userContext: serviceContext,
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
                const executionContext: ExecutionContext = {
                    eventBus: options.eventBus,
                    emitUserEvent,
                    flowInfo,
                    flowMiddleware: options.plan.flow.middleware,
                    params: options.params,
                    runController: options.runController,
                    runId: options.runId,
                    scopedContext: serviceContext,
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
                ) as CompletedResult<StateShape>;

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
        await disposeService(options.service, serviceContext, serviceApi, logInternal);
    }
};
