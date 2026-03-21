import type { Simplify, StripIndexSignature } from "../utils/type-helpers.ts";

// ── Primitives ──────────────────────────────────────────────────────

export type StateShape = Record<string, unknown>;
export type EventMap = Record<string, Record<string, unknown>>;
export type LogLevel = "debug" | "error" | "info" | "warn";
export type RunStatus = "cancelled" | "completed" | "failed" | "paused" | "running";
export type TerminalStatus = "cancelled" | "completed" | "failed";
export type TaskStatus = "completed" | "failed" | "skipped";
export type ParallelMode = "all-settled" | "fail-fast";
export type RetryStrategy = "constant" | "exponential";
export type ErrorResolution = "fail" | "skip";

// ── Info ─────────────────────────────────────────────────────────────

export interface FlowInfo {
    readonly id: string;
    readonly name: string;
}

export interface TaskInfo {
    readonly id: string;
    readonly name: string;
}

export interface ParallelBranchInfo {
    readonly branchId: string;
    readonly branchName: string;
    readonly groupId: string;
    readonly groupName: string;
    readonly index: number;
}

// ── Logging ──────────────────────────────────────────────────────────

export interface LogEvent {
    readonly data?: unknown;
    readonly level: LogLevel;
    readonly message: string;
    readonly taskId?: string;
    readonly taskName?: string;
}

export interface Logger {
    debug(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
}

// ── Events ───────────────────────────────────────────────────────────

export interface BuiltInEventMap {
    readonly log: LogEvent;
}

export interface LifecycleEventMap {
    readonly "flow.ended": {
        readonly cancelReason?: string;
        readonly durationMs: number;
        readonly error?: Error;
        readonly flowName: string;
        readonly status: TerminalStatus;
        readonly stopReason?: string;
    };
    readonly "flow.started": {
        readonly flowName: string;
        readonly params: unknown;
    };
    readonly "task.ended": {
        readonly attempt: number;
        readonly attempts: number;
        readonly durationMs: number;
        readonly error?: Error;
        readonly status: TaskStatus;
        readonly taskId: string;
        readonly taskName: string;
    };
    readonly "task.retrying": {
        readonly attempt: number;
        readonly attempts: number;
        readonly delayMs: number;
        readonly error: Error;
        readonly taskId: string;
        readonly taskName: string;
    };
    readonly "task.started": {
        readonly attempt: number;
        readonly attempts: number;
        readonly taskId: string;
        readonly taskName: string;
    };
}

export type EngineEventMap<TUserEvents extends EventMap = {}> = {
    [K in
        | keyof LifecycleEventMap
        | keyof BuiltInEventMap
        | keyof StripIndexSignature<TUserEvents>]: K extends keyof LifecycleEventMap
        ? LifecycleEventMap[K]
        : K extends keyof BuiltInEventMap
          ? BuiltInEventMap[K]
          : K extends keyof TUserEvents
            ? TUserEvents[K]
            : never;
} & EventMap;

export interface EventMetadata<TType extends string = string> {
    readonly flowId: string;
    readonly runId: string;
    readonly timestamp: Date;
    readonly type: TType;
}

export type EventEnvelope<TType extends string, TPayload extends Record<string, unknown>> = Readonly<
    Simplify<StripIndexSignature<TPayload> & EventMetadata<TType>>
>;

export type EventHandler<TType extends string, TPayload extends Record<string, unknown>> = (
    event: EventEnvelope<TType, TPayload>
) => void | Promise<void>;

export type AnyEventEnvelope<TEvents extends EventMap> = {
    [TType in keyof TEvents & string]: EventEnvelope<TType, TEvents[TType]>;
}[keyof TEvents & string];

export interface EventSubscriberApi<TEvents extends EventMap> {
    on<TType extends keyof TEvents & string>(type: TType, handler: EventHandler<TType, TEvents[TType]>): () => void;
    onAny(
        handler: (type: keyof TEvents & string, event: AnyEventEnvelope<TEvents>) => void | Promise<void>
    ): () => void;
}

export type EventSubscriber<TEvents extends EventMap> = (events: EventSubscriberApi<TEvents>) => void;

// ── State ────────────────────────────────────────────────────────────

export interface StateStore<TState extends StateShape> {
    get<TKey extends keyof TState>(key: TKey): TState[TKey] | undefined;
    has<TKey extends keyof TState>(key: TKey): boolean;
    patch(values: Partial<TState>): void;
    set<TKey extends keyof TState>(key: TKey, value: TState[TKey]): void;
    snapshot(): Readonly<TState>;
}

// ── Context ──────────────────────────────────────────────────────────

export interface FlowContext<TParams = unknown, TState extends StateShape = StateShape> {
    emit(type: string, data: Record<string, unknown>): void;
    readonly flow: FlowInfo;
    readonly log: Logger;
    readonly params: TParams;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly state: StateStore<TState>;
    stop(reason?: string): never;
}

export interface TaskContext<TParams = unknown, TState extends StateShape = StateShape>
    extends FlowContext<TParams, TState> {
    readonly attempt: number;
    readonly task: TaskInfo;
}

// ── Context Utility Types ────────────────────────────────────────────

export type ParamsOf<T> = T extends FlowContext<infer P, any> ? P : never;
export type StateOf<T> = T extends FlowContext<any, infer S> ? S : never;
export type FlowCtxOf<TContext extends TaskContext> = FlowContext<ParamsOf<TContext>, StateOf<TContext>> &
    Omit<TContext, keyof TaskContext>;

// ── Handlers & Middleware ────────────────────────────────────────────

export type TaskHandler<TContext extends TaskContext = TaskContext> = (context: TContext) => unknown | Promise<unknown>;

export type MiddlewareNext = () => Promise<void>;

export type Middleware<TContext extends TaskContext = TaskContext> = (
    context: TContext,
    next: MiddlewareNext
) => void | Promise<void>;

// ── Retry & Error Resolution ─────────────────────────────────────────

export interface RetryPolicy {
    readonly attempts: number;
    readonly delayMs?: number;
    readonly maxDelayMs?: number;
    readonly strategy?: RetryStrategy;
}

export interface ErrorResolutionMeta {
    readonly attempt: number;
    readonly attempts: number;
}

export type ErrorResolver<TContext extends TaskContext = TaskContext> = (
    error: Error,
    context: TContext,
    meta: ErrorResolutionMeta
) => ErrorResolution | Promise<ErrorResolution>;

export type TaskErrorResolution<TContext extends TaskContext = TaskContext> = ErrorResolution | ErrorResolver<TContext>;

// ── Parallel Options ─────────────────────────────────────────────────

export type MergeResolver<TState extends StateShape> = <TKey extends keyof TState>(
    key: TKey,
    values: readonly TState[TKey][]
) => TState[TKey];

export type MergeStrategy<TState extends StateShape> = "arrays" | "overwrite" | "strict" | MergeResolver<TState>;

// ── Node Definitions ─────────────────────────────────────────────────

export interface TaskOptions<TContext extends TaskContext = TaskContext> {
    readonly middleware?: readonly Middleware<TContext>[];
    readonly name?: string;
    readonly onError?: TaskErrorResolution<TContext>;
    readonly retry?: RetryPolicy;
    readonly timeoutMs?: number;
}

export interface GroupOptions {
    readonly name?: string;
}

export interface ParallelOptions<TContext extends TaskContext = TaskContext> extends GroupOptions {
    readonly cleanupContext?: (context: FlowCtxOf<TContext>, meta: ParallelBranchInfo) => void | Promise<void>;
    readonly concurrency?: number;
    readonly forkContext?: (
        context: FlowCtxOf<TContext>,
        meta: ParallelBranchInfo
    ) => FlowCtxOf<TContext> | Promise<FlowCtxOf<TContext>>;
    readonly merge?: MergeStrategy<StateOf<TContext>>;
    readonly mode?: ParallelMode;
}

export interface TaskDefinition<TContext extends TaskContext = TaskContext> {
    readonly handler: TaskHandler<TContext>;
    readonly id: string;
    readonly kind: "task";
    readonly middleware: readonly Middleware<TContext>[];
    readonly name: string;
    readonly onError?: TaskErrorResolution<TContext>;
    readonly retry?: RetryPolicy;
    readonly timeoutMs?: number;
}

export interface GroupDefinition<TContext extends TaskContext = TaskContext> {
    readonly children: readonly FlowNode<TContext>[];
    readonly id: string;
    readonly kind: "group";
    readonly name: string;
}

export interface ParallelDefinition<TContext extends TaskContext = TaskContext> {
    readonly children: readonly FlowNode<TContext>[];
    readonly cleanupContext?: (context: FlowCtxOf<TContext>, meta: ParallelBranchInfo) => void | Promise<void>;
    readonly concurrency?: number;
    readonly forkContext?: (
        context: FlowCtxOf<TContext>,
        meta: ParallelBranchInfo
    ) => FlowCtxOf<TContext> | Promise<FlowCtxOf<TContext>>;
    readonly id: string;
    readonly kind: "parallel";
    readonly merge: MergeStrategy<StateOf<TContext>>;
    readonly mode: ParallelMode;
    readonly name: string;
}

export type FlowNode<TContext extends TaskContext = TaskContext> =
    | GroupDefinition<TContext>
    | ParallelDefinition<TContext>
    | TaskDefinition<TContext>;

// ── Flow Definition ──────────────────────────────────────────────────

export interface FlowHooks<TContext extends TaskContext = TaskContext> {
    readonly onComplete?: (context: FlowCtxOf<TContext>, result: RunResult<StateOf<TContext>>) => void | Promise<void>;
    readonly onFailure?: (context: FlowCtxOf<TContext>, error: Error) => void | Promise<void>;
    readonly onStart?: (context: FlowCtxOf<TContext>) => void | Promise<void>;
    readonly onSuccess?: (
        context: FlowCtxOf<TContext>,
        result: CompletedResult<StateOf<TContext>>
    ) => void | Promise<void>;
}

export interface FlowBuilderApi<TContext extends TaskContext = TaskContext> {
    group(id: string, children: readonly FlowNode<TContext>[], options?: GroupOptions): GroupDefinition<TContext>;

    parallel(
        id: string,
        children: readonly FlowNode<TContext>[],
        options?: ParallelOptions<TContext>
    ): ParallelDefinition<TContext>;

    task(id: string, handler: TaskHandler<TContext>, options?: TaskOptions<TContext>): TaskDefinition<TContext>;
}

export interface FlowDefinition<TContext extends TaskContext = TaskContext> {
    readonly hooks: FlowHooks<TContext>;
    readonly id: string;
    readonly initialState?: StateOf<TContext> | (() => StateOf<TContext>);
    readonly middleware: readonly Middleware<TContext>[];
    readonly name: string;
    readonly nodes: readonly FlowNode<TContext>[];
}

// ── Run Result ───────────────────────────────────────────────────────

export interface TaskRunResult {
    readonly attempts: number;
    readonly durationMs: number;
    readonly error?: Error;
    readonly status: TaskStatus;
    readonly taskId: string;
    readonly taskName: string;
}

export interface BaseRunResult<TState extends StateShape> {
    readonly durationMs: number;
    readonly flowId: string;
    readonly flowName: string;
    readonly runId: string;
    readonly state: Readonly<TState>;
    readonly tasks: readonly TaskRunResult[];
}

export interface CompletedResult<TState extends StateShape> extends BaseRunResult<TState> {
    readonly cancelReason?: undefined;
    readonly error?: undefined;
    readonly status: "completed";
    readonly stopReason?: string;
}

export interface FailedResult<TState extends StateShape> extends BaseRunResult<TState> {
    readonly cancelReason?: undefined;
    readonly error: Error;
    readonly status: "failed";
    readonly stopReason?: string;
}

export interface CancelledResult<TState extends StateShape> extends BaseRunResult<TState> {
    readonly cancelReason?: string;
    readonly error?: undefined;
    readonly status: "cancelled";
    readonly stopReason?: string;
}

export type RunResult<TState extends StateShape> =
    | CancelledResult<TState>
    | CompletedResult<TState>
    | FailedResult<TState>;

// ── ServiceFactory ──────────────────────────────────────────────────

export interface ServiceFactoryApi {
    emit(type: string, data: Record<string, unknown>): void;
    readonly flow: FlowInfo;
    readonly log: Logger;
    readonly params: unknown;
    readonly runId: string;
    readonly signal: AbortSignal;
}

export interface ServiceFactory<TExt extends object> {
    create(api: ServiceFactoryApi): TExt | Promise<TExt>;
    dispose?(ext: TExt, api: ServiceFactoryApi): void | Promise<void>;
}

// ── FlowHandle ───────────────────────────────────────────────────────

export interface FlowHandle<TState extends StateShape> {
    cancel(reason?: string): void;
    readonly flowId: string;
    join(): Promise<RunResult<TState>>;
    pause(): Promise<void>;
    resume(): void;
    readonly runId: string;
    status(): RunStatus;
}

// ── Engine Options ───────────────────────────────────────────────────

export interface FlowEngineOptions<TExt extends object = object, TUserEvents extends EventMap = {}> {
    readonly onSubscriberError?: (error: Error, type: string) => void;
    readonly services?: ServiceFactory<TExt>;
    readonly subscribers?: readonly EventSubscriber<EngineEventMap<TUserEvents>>[];
}
