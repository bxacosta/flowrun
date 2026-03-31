import type {
    FlowContext,
    FlowInfo,
    LogEvent,
    Logger,
    StateShape,
    StateStore,
    TaskContext,
    TaskInfo,
} from "../core/types.ts";

export interface SharedContextOptions {
    readonly emit: (type: string, data: object) => void;
    readonly flow: FlowInfo;
    readonly params: unknown;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly state: StateStore<StateShape>;
    readonly stop: (reason?: string) => never;
    readonly userContext: object;
}

export const buildLogger = (emit: (payload: LogEvent) => void, task?: TaskInfo): Logger => ({
    debug: (message, data) => emit({ data, level: "debug", message, taskId: task?.id, taskName: task?.name }),
    error: (message, data) => emit({ data, level: "error", message, taskId: task?.id, taskName: task?.name }),
    info: (message, data) => emit({ data, level: "info", message, taskId: task?.id, taskName: task?.name }),
    warn: (message, data) => emit({ data, level: "warn", message, taskId: task?.id, taskName: task?.name }),
});

const createLogger = (options: SharedContextOptions, task: TaskInfo | undefined): Logger =>
    buildLogger((payload) => options.emit("log", payload), task);

export const createFlowContext = (options: SharedContextOptions): FlowContext =>
    ({
        ...options.userContext,
        emit: options.emit,
        flow: options.flow,
        log: createLogger(options, undefined),
        params: options.params,
        runId: options.runId,
        signal: options.signal,
        state: options.state,
        stop: options.stop,
    }) as FlowContext;

export const createTaskContext = (options: SharedContextOptions, task: TaskInfo, attempt: number): TaskContext =>
    ({
        ...options.userContext,
        attempt,
        emit: options.emit,
        flow: options.flow,
        log: createLogger(options, task),
        params: options.params,
        runId: options.runId,
        signal: options.signal,
        state: options.state,
        stop: options.stop,
        task,
    }) as TaskContext;
