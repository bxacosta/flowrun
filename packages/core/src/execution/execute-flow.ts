import { coreContextKeys } from "../core/constants.ts";
import { FlowEngineError } from "../core/errors.ts";
import type {
    CompletedResult,
    Extension,
    ExtensionApi,
    FlowContext,
    FlowInfo,
    LogEvent,
    Logger,
    RunResult,
    StateShape,
    TaskRunResult,
} from "../core/types.ts";
import type { RunController } from "../engine/run-controller.ts";
import type { AnyEventBus } from "../events/event-bus.ts";
import { FlowStateStore } from "../state/state-store.ts";
import { cloneValue } from "../utils/clone.ts";
import { normalizeError } from "../utils/errors.ts";
import { getDurationMs } from "../utils/time.ts";
import { buildLogger, createFlowContext } from "./context-factory.ts";
import { dispatchEvent } from "./dispatch.ts";
import { executeNodes } from "./execute-nodes.ts";
import type { ExecutionContext } from "./execution-types.ts";
import type { ResolvedFlowPlan } from "./resolver.ts";

// ── Extension helpers ───────────────────────────────────────────────

export interface ExecuteFlowOptions {
    readonly eventBus: AnyEventBus;
    readonly extension?: Extension<object>;
    readonly params: unknown;
    readonly plan: ResolvedFlowPlan;
    readonly runController: RunController;
    readonly runId: string;
}

const createInitialState = (initialState: StateShape | (() => StateShape) | undefined): Partial<StateShape> => {
    if (initialState === undefined) {
        return {};
    }

    const resolved = typeof initialState === "function" ? initialState() : initialState;
    return cloneValue(resolved);
};

const validateExtensionContext = (context: object): void => {
    if (Array.isArray(context) || context === null) {
        throw new FlowEngineError("Extension context must be an object");
    }

    for (const key of Object.keys(context)) {
        if (coreContextKeys.includes(key as (typeof coreContextKeys)[number])) {
            throw new FlowEngineError(`Extension context key "${key}" collides with a core context property`);
        }
    }
};

// ── Run result ─────────────────────────────────────────────────────

interface CreateRunResultOptions {
    readonly cancelReason: string | undefined;
    readonly durationMs: number;
    readonly error: Error | undefined;
    readonly flowInfo: FlowInfo;
    readonly runId: string;
    readonly stateStore: FlowStateStore<StateShape>;
    readonly status: "cancelled" | "completed" | "failed";
    readonly stopReason: string | undefined;
    readonly taskResults: readonly TaskRunResult[];
}

const createRunResult = (options: CreateRunResultOptions): RunResult<StateShape> => {
    const base = {
        durationMs: options.durationMs,
        flowId: options.flowInfo.id,
        flowName: options.flowInfo.name,
        runId: options.runId,
        state: options.stateStore.snapshot(),
        tasks: options.taskResults,
    };

    if (options.status === "completed") {
        return { ...base, status: options.status, stopReason: options.stopReason };
    }

    if (options.status === "cancelled") {
        return { ...base, cancelReason: options.cancelReason, status: options.status, stopReason: options.stopReason };
    }

    return {
        ...base,
        error: options.error ?? new Error("Flow execution failed"),
        status: options.status,
        stopReason: options.stopReason,
    };
};

// ── Extension lifecycle ────────────────────────────────────────────

const createExtensionApi = (
    flowInfo: FlowInfo,
    params: unknown,
    runId: string,
    signal: AbortSignal,
    eventBus: AnyEventBus
): ExtensionApi => {
    const emit = (type: string, data: object): void => {
        dispatchEvent(eventBus, flowInfo.id, runId, type, data);
    };

    const emitLog = (payload: LogEvent): void => {
        dispatchEvent(eventBus, flowInfo.id, runId, "log", payload);
    };

    const log: Logger = buildLogger(emitLog);

    return { emit, flow: flowInfo, log, params, runId, signal };
};

const createExtensionContext = async (extension: Extension<object> | undefined, api: ExtensionApi): Promise<object> => {
    if (extension === undefined) {
        return {};
    }

    const context = await extension.create(api);
    validateExtensionContext(context);
    return context;
};

const disposeExtension = async (
    extension: Extension<object> | undefined,
    context: object,
    api: ExtensionApi,
    logInternal: (message: string, data?: unknown) => void
): Promise<void> => {
    if (extension === undefined || extension.dispose === undefined) {
        return;
    }

    try {
        await extension.dispose(context, api);
    } catch (error) {
        logInternal("Extension dispose failed", { error: normalizeError(error) });
    }
};

const resolveFailedStatus = (runController: RunController, error: Error): "cancelled" | "failed" =>
    runController.isCancelled && error.name === "AbortError" ? "cancelled" : "failed";

const callHookSafely = async (
    fn: () => void | Promise<void>,
    logInternal: (message: string, data?: unknown) => void,
    label: string
): Promise<void> => {
    try {
        await fn();
    } catch (error) {
        logInternal(label, { error: normalizeError(error) });
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

    let extensionContext: object = {};
    let flowContext: FlowContext | undefined;
    let finalError: Error | undefined;
    let finalStatus: "cancelled" | "completed" | "failed" = "completed";

    const dispatch = (type: string, payload: object): void => {
        dispatchEvent(options.eventBus, flowInfo.id, options.runId, type, payload);
    };

    const logInternal = (message: string, data?: unknown): void => {
        dispatch("log", { data, level: "error", message });
    };

    const extensionApi = createExtensionApi(
        flowInfo,
        options.params,
        options.runId,
        options.runController.signal,
        options.eventBus
    );

    try {
        extensionContext = await createExtensionContext(options.extension, extensionApi);

        const ctx = createFlowContext({
            emit: dispatch,
            flow: flowInfo,
            params: options.params,
            runId: options.runId,
            signal: options.runController.signal,
            state: stateStore,
            stop: (reason) => options.runController.requestStop(reason),
            userContext: extensionContext,
        });
        flowContext = ctx;

        dispatch("flow.started", { flowName: flowInfo.name, params: options.params });

        try {
            if (options.plan.flow.hooks.onStart !== undefined) {
                await options.plan.flow.hooks.onStart(ctx);
            }

            if (!(options.runController.isCancelled || options.runController.isStopped)) {
                const executionContext: ExecutionContext = {
                    emitUserEvent: dispatch,
                    eventBus: options.eventBus,
                    flowInfo,
                    flowMiddleware: options.plan.flow.middleware,
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
                const successResult = createRunResult({
                    cancelReason: undefined,
                    durationMs: getDurationMs(startTime),
                    error: undefined,
                    flowInfo,
                    runId: options.runId,
                    stateStore,
                    status: "completed",
                    stopReason: options.runController.stopReason,
                    taskResults,
                }) as CompletedResult<StateShape>;

                await options.plan.flow.hooks.onSuccess(ctx, successResult);
            }
        } catch (error) {
            const caughtError = normalizeError(error);
            finalError = caughtError;
            finalStatus = resolveFailedStatus(options.runController, caughtError);

            const onFailure = options.plan.flow.hooks.onFailure;
            if (finalStatus === "failed" && onFailure !== undefined) {
                await callHookSafely(() => onFailure(ctx, caughtError), logInternal, "Flow failure hook failed");
            }
        }
    } catch (error) {
        finalError = normalizeError(error);
        finalStatus = resolveFailedStatus(options.runController, finalError);
    }

    // ── Unified finalization ────────────────────────────────────────

    const result = createRunResult({
        cancelReason: options.runController.cancelReason,
        durationMs: getDurationMs(startTime),
        error: finalStatus === "failed" ? finalError : undefined,
        flowInfo,
        runId: options.runId,
        stateStore,
        status: finalStatus,
        stopReason: options.runController.stopReason,
        taskResults,
    });

    dispatch("flow.ended", {
        cancelReason: result.status === "cancelled" ? result.cancelReason : undefined,
        durationMs: result.durationMs,
        error: result.status === "failed" ? result.error : undefined,
        flowName: flowInfo.name,
        status: result.status,
        stopReason: result.stopReason,
    });

    if (flowContext !== undefined && options.plan.flow.hooks.onComplete !== undefined) {
        const ctx = flowContext;
        const onComplete = options.plan.flow.hooks.onComplete;
        await callHookSafely(() => onComplete(ctx, result), logInternal, "Flow completion hook failed");
    }

    options.runController.setTerminalStatus(result.status);
    await disposeExtension(options.extension, extensionContext, extensionApi, logInternal);

    return result;
};
