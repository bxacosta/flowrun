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
    readonly emit: (type: string, data: Record<string, unknown>) => void;
    readonly flow: FlowInfo;
    readonly params: unknown;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly state: StateStore<StateShape>;
    readonly stop: (reason?: string) => never;
    readonly userContext: object;
}

const emitLog = (options: SharedContextOptions, payload: LogEvent): void => {
    options.emit("log", payload as unknown as Record<string, unknown>);
};

const createLogger = (options: SharedContextOptions, task: TaskInfo | undefined): Logger => ({
    debug: (message, data) => {
        emitLog(options, { data, level: "debug", message, taskId: task?.id, taskName: task?.name });
    },
    error: (message, data) => {
        emitLog(options, { data, level: "error", message, taskId: task?.id, taskName: task?.name });
    },
    info: (message, data) => {
        emitLog(options, { data, level: "info", message, taskId: task?.id, taskName: task?.name });
    },
    warn: (message, data) => {
        emitLog(options, { data, level: "warn", message, taskId: task?.id, taskName: task?.name });
    },
});

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
