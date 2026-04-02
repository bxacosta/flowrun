import type { EventBus } from "../events/event-bus.ts";
import type { AnyRecord, ObjectRecord, Simplify, StripIndexSignature } from "../utils/type-helpers.ts";

// ── Primitives ──────────────────────────────────────────────────────

export type StateShape = Record<string, unknown>;
export type EventMap = Record<string, Record<string, unknown>>;
export type EmptyEventMap = Record<never, never>;

export type LogLevel = "debug" | "error" | "info" | "warn";
export type RunStatus = "cancelled" | "completed" | "failed" | "paused" | "running";
export type TerminalStatus = "cancelled" | "completed" | "failed";
export type TaskStatus = "completed" | "failed" | "skipped";
export type ParallelMode = "all-settled" | "fail-fast";
export type RetryStrategy = "constant" | "exponential";
export type ErrorResolution = "fail" | "skip";

// ── Info ────────────────────────────────────────────────────────────

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

// ── Logging ─────────────────────────────────────────────────────────

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

// ── Events ──────────────────────────────────────────────────────────

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

export type EngineEventMap<TUserEvents extends ObjectRecord<TUserEvents> = EmptyEventMap> = {
    [TEventKey in
        | keyof LifecycleEventMap
        | keyof BuiltInEventMap
        | keyof StripIndexSignature<TUserEvents>]: TEventKey extends keyof LifecycleEventMap
        ? LifecycleEventMap[TEventKey]
        : TEventKey extends keyof BuiltInEventMap
          ? BuiltInEventMap[TEventKey]
          : TEventKey extends keyof TUserEvents
            ? TUserEvents[TEventKey]
            : never;
};

export interface EventMetadata<TType extends string = string> {
    readonly flowId: string;
    readonly runId: string;
    readonly timestamp: Date;
    readonly type: TType;
}

export type EventEnvelope<TType extends string, TPayload extends object> = Readonly<
    Simplify<StripIndexSignature<TPayload> & EventMetadata<TType>>
>;

export type EventHandler<TType extends string, TPayload extends object> = (
    event: EventEnvelope<TType, TPayload>
) => void | Promise<void>;

export type AnyEventEnvelope<TEvents extends ObjectRecord<TEvents>> = {
    [TType in keyof TEvents & string]: EventEnvelope<TType, TEvents[TType]>;
}[keyof TEvents & string];

export interface EventSubscriberApi<TEvents extends ObjectRecord<TEvents>> {
    on<TType extends keyof TEvents & string>(type: TType, handler: EventHandler<TType, TEvents[TType]>): () => void;
    onAny(
        handler: (type: keyof TEvents & string, event: AnyEventEnvelope<TEvents>) => void | Promise<void>
    ): () => void;
}

export type EventSubscriber<TEvents extends ObjectRecord<TEvents>> = (events: EventSubscriberApi<TEvents>) => void;

// ── State ───────────────────────────────────────────────────────────

export interface StateStore<TState extends AnyRecord<TState>> {
    get<TStateKey extends keyof TState>(key: TStateKey): TState[TStateKey] | undefined;
    has<TStateKey extends keyof TState>(key: TStateKey): boolean;
    patch(values: Partial<TState>): void;
    set<TStateKey extends keyof TState>(key: TStateKey, value: TState[TStateKey]): void;
    snapshot(): Readonly<TState>;
}

// ── Context ─────────────────────────────────────────────────────────

export interface FlowContext<
    TParams = unknown,
    // biome-ignore lint/suspicious/noExplicitAny: defaults use `any` so bare FlowContext/TaskContext constraints accept all state/event types
    TState extends AnyRecord<TState> = any,
    // biome-ignore lint/suspicious/noExplicitAny: defaults use `any` so bare FlowContext/TaskContext constraints accept all state/event types
    TEvents extends ObjectRecord<TEvents> = any,
> {
    emit<TType extends keyof TEvents & string>(type: TType, data: TEvents[TType]): void;
    readonly flow: FlowInfo;
    readonly log: Logger;
    readonly params: TParams;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly state: StateStore<TState>;
    stop(reason?: string): never;
}

export interface TaskContext<
    TParams = unknown,
    // biome-ignore lint/suspicious/noExplicitAny: defaults use `any` so bare FlowContext/TaskContext constraints accept all state/event types
    TState extends AnyRecord<TState> = any,
    // biome-ignore lint/suspicious/noExplicitAny: defaults use `any` so bare FlowContext/TaskContext constraints accept all state/event types
    TEvents extends ObjectRecord<TEvents> = any,
> extends FlowContext<TParams, TState, TEvents> {
    readonly attempt: number;
    readonly task: TaskInfo;
}

// ── Context Utilities ───────────────────────────────────────────────

export type ParamsOf<TContext> =
    TContext extends FlowContext<infer TParams, infer _TState, infer _TEvents> ? TParams : never;
export type StateOf<TContext> =
    TContext extends FlowContext<infer _TParams, infer TState, infer _TEvents> ? TState : never;
export type EventsOf<TContext> =
    TContext extends FlowContext<infer _TParams, infer _TState, infer TEvents> ? TEvents : never;
export type FlowContextOf<TContext extends TaskContext> = Omit<TContext, "attempt" | "task">;

// ── Handlers & Middleware ───────────────────────────────────────────

export type TaskHandler<TContext extends TaskContext = TaskContext> = (context: TContext) => unknown | Promise<unknown>;

export type MiddlewareNext = () => Promise<void>;

export type Middleware<TContext extends TaskContext = TaskContext> = (
    context: TContext,
    next: MiddlewareNext
) => void | Promise<void>;

// ── Retry & Error Handling ──────────────────────────────────────────

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

// ── Node Options ────────────────────────────────────────────────────

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

export type MergeResolver<TState extends AnyRecord<TState>> = <TStateKey extends keyof TState>(
    stateKey: TStateKey,
    values: readonly TState[TStateKey][]
) => TState[TStateKey];

export type MergeStrategy<TState extends AnyRecord<TState>> = "arrays" | "overwrite" | "strict" | MergeResolver<TState>;

export interface ParallelOptions<TContext extends TaskContext = TaskContext> extends GroupOptions {
    readonly cleanupContext?: (context: FlowContextOf<TContext>, meta: ParallelBranchInfo) => void | Promise<void>;
    readonly concurrency?: number;
    readonly forkContext?: (
        context: FlowContextOf<TContext>,
        meta: ParallelBranchInfo
    ) => FlowContextOf<TContext> | Promise<FlowContextOf<TContext>>;
    readonly merge?: MergeStrategy<StateOf<TContext>>;
    readonly mode?: ParallelMode;
}

// ── Node Definitions ────────────────────────────────────────────────

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
    readonly cleanupContext?: (context: FlowContextOf<TContext>, meta: ParallelBranchInfo) => void | Promise<void>;
    readonly concurrency?: number;
    readonly forkContext?: (
        context: FlowContextOf<TContext>,
        meta: ParallelBranchInfo
    ) => FlowContextOf<TContext> | Promise<FlowContextOf<TContext>>;
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

// ── Flow Builder ────────────────────────────────────────────────────

export interface FlowBuilderApi<TContext extends TaskContext = TaskContext> {
    group(id: string, children: readonly FlowNode<TContext>[], options?: GroupOptions): GroupDefinition<TContext>;

    parallel(
        id: string,
        children: readonly FlowNode<TContext>[],
        options?: ParallelOptions<TContext>
    ): ParallelDefinition<TContext>;

    task(id: string, handler: TaskHandler<TContext>, options?: TaskOptions<TContext>): TaskDefinition<TContext>;
}

// ── Flow Definition ─────────────────────────────────────────────────

export interface FlowHooks<TContext extends TaskContext = TaskContext> {
    readonly onComplete?: (
        context: FlowContextOf<TContext>,
        result: RunResult<StateOf<TContext>>
    ) => void | Promise<void>;
    readonly onFailure?: (context: FlowContextOf<TContext>, error: Error) => void | Promise<void>;
    readonly onStart?: (context: FlowContextOf<TContext>) => void | Promise<void>;
    readonly onSuccess?: (
        context: FlowContextOf<TContext>,
        result: CompletedResult<StateOf<TContext>>
    ) => void | Promise<void>;
}

export interface FlowDefinition<TContext extends TaskContext = TaskContext> {
    readonly hooks: FlowHooks<TContext>;
    readonly id: string;
    readonly initialState?: StateOf<TContext> | (() => StateOf<TContext>);
    readonly middleware: readonly Middleware<TContext>[];
    readonly name: string;
    readonly nodes: readonly FlowNode<TContext>[];
}

// ── Run Result ──────────────────────────────────────────────────────

export interface TaskRunResult {
    readonly attempts: number;
    readonly durationMs: number;
    readonly error?: Error;
    readonly status: TaskStatus;
    readonly taskId: string;
    readonly taskName: string;
}

export interface BaseRunResult<TState extends AnyRecord<TState>> {
    readonly durationMs: number;
    readonly flowId: string;
    readonly flowName: string;
    readonly runId: string;
    readonly state: Readonly<TState>;
    readonly tasks: readonly TaskRunResult[];
}

export interface CompletedResult<TState extends AnyRecord<TState>> extends BaseRunResult<TState> {
    readonly cancelReason?: undefined;
    readonly error?: undefined;
    readonly status: "completed";
    readonly stopReason?: string;
}

export interface FailedResult<TState extends AnyRecord<TState>> extends BaseRunResult<TState> {
    readonly cancelReason?: undefined;
    readonly error: Error;
    readonly status: "failed";
    readonly stopReason?: string;
}

export interface CancelledResult<TState extends AnyRecord<TState>> extends BaseRunResult<TState> {
    readonly cancelReason?: string;
    readonly error?: undefined;
    readonly status: "cancelled";
    readonly stopReason?: string;
}

export type RunResult<TState extends AnyRecord<TState>> =
    | CancelledResult<TState>
    | CompletedResult<TState>
    | FailedResult<TState>;

// ── Extension ───────────────────────────────────────────────────────

export interface ExtensionApi {
    emit(type: string, data: object): void;
    readonly flow: FlowInfo;
    readonly log: Logger;
    readonly params: unknown;
    readonly runId: string;
    readonly signal: AbortSignal;
}

export interface Extension<TExtension extends object> {
    create(extensionApi: ExtensionApi): TExtension | Promise<TExtension>;
    dispose?(extensionContext: TExtension, extensionApi: ExtensionApi): void | Promise<void>;
}

// ── Flow Handle ─────────────────────────────────────────────────────

export interface FlowHandle<TState extends AnyRecord<TState>> {
    cancel(reason?: string): void;
    readonly flowId: string;
    join(): Promise<RunResult<TState>>;
    pause(): Promise<void>;
    resume(): void;
    readonly runId: string;
    status(): RunStatus;
}

// ── Engine Options ──────────────────────────────────────────────────

export interface FlowEngineOptions<TUserEvents extends ObjectRecord<TUserEvents> = EmptyEventMap> {
    readonly onSubscriberError?: (error: Error, type: string) => void;
    readonly subscribers?: readonly EventSubscriber<EngineEventMap<TUserEvents>>[];
}

// ── Type-erased aliases ─────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyFlowDefinition = FlowDefinition<any>;
// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyFlowNode = FlowNode<any>;
// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyMiddleware = Middleware<any>;
// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyParallelDefinition = ParallelDefinition<any>;
// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyTaskDefinition = TaskDefinition<any>;
// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyExtension = Extension<any>;
// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyEventBus = EventBus<any>;
