import type {
    FlowContext,
    FlowInfo,
    LogEvent,
    Logger,
    StateShape,
    StateStore,
    TaskContext,
    TaskInfo,
    UserEmitEventMap,
    UserEventMap,
} from "../core/types.ts";

export interface SharedContextOptions<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> {
    readonly emit: <TType extends keyof UserEmitEventMap<TUserEvents> & string>(
        type: TType,
        data: UserEmitEventMap<TUserEvents>[TType]
    ) => void;
    readonly flow: FlowInfo;
    readonly params: TParams;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly state: StateStore<TState>;
    readonly stop: (reason?: string) => never;
    readonly userContext: TContext;
}

const emitLog = <TParams, TState extends StateShape, TContext extends object, TUserEvents extends UserEventMap>(
    options: SharedContextOptions<TParams, TState, TContext, TUserEvents>,
    payload: LogEvent
): void => {
    options.emit("log" as keyof UserEmitEventMap<TUserEvents> & string, payload as any);
};

const createLogger = <TParams, TState extends StateShape, TContext extends object, TUserEvents extends UserEventMap>(
    options: SharedContextOptions<TParams, TState, TContext, TUserEvents>,
    task: TaskInfo | undefined
): Logger => ({
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

export const createFlowContext = <
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
>(
    options: SharedContextOptions<TParams, TState, TContext, TUserEvents>
): FlowContext<TParams, TState, TContext, TUserEvents> =>
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
    }) as FlowContext<TParams, TState, TContext, TUserEvents>;

export const createTaskContext = <
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
>(
    options: SharedContextOptions<TParams, TState, TContext, TUserEvents>,
    task: TaskInfo,
    attempt: number
): TaskContext<TParams, TState, TContext, TUserEvents> =>
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
    }) as TaskContext<TParams, TState, TContext, TUserEvents>;
