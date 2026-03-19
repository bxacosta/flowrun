import type { CollapseIntersection, Simplify, StripIndexSignature } from "../utils/type-helpers.ts";

// ── Branded type tokens (internal) ──────────────────────────────────

declare const flowDefinitionToken: unique symbol;
declare const flowNodeToken: unique symbol;

interface FlowTypeMetadata<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
> {
    readonly baseContext: TBaseContext;
    readonly params: TParams;
    readonly requiredContext: TRequiredContext;
    readonly state: TState;
    readonly userEvents: TUserEvents;
}

type FlowNodeContextMetadata<TRequiredContext extends object> = TRequiredContext;

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

export type UserEventMap = EventMap;

type ReservedEventName = keyof BuiltInEventMap | keyof LifecycleEventMap;
type CleanUserEvents<T extends UserEventMap> = Omit<StripIndexSignature<T>, ReservedEventName>;

export type EngineEventMap<TUserEvents extends UserEventMap, TExtensionEvents extends UserEventMap> = {
    [K in
        | keyof LifecycleEventMap
        | keyof BuiltInEventMap
        | keyof CleanUserEvents<TUserEvents>
        | keyof CleanUserEvents<TExtensionEvents>]: K extends keyof LifecycleEventMap
        ? LifecycleEventMap[K]
        : K extends keyof BuiltInEventMap
          ? BuiltInEventMap[K]
          : K extends keyof CleanUserEvents<TUserEvents>
            ? CleanUserEvents<TUserEvents>[K]
            : K extends keyof CleanUserEvents<TExtensionEvents>
              ? CleanUserEvents<TExtensionEvents>[K]
              : never;
} & EventMap;

export type UserEmitEventMap<TUserEvents extends UserEventMap> = {
    [K in keyof BuiltInEventMap | keyof CleanUserEvents<TUserEvents>]: K extends keyof BuiltInEventMap
        ? BuiltInEventMap[K]
        : K extends keyof CleanUserEvents<TUserEvents>
          ? CleanUserEvents<TUserEvents>[K]
          : never;
};

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

export interface CoreFlowContext<TParams, TState extends StateShape, TUserEvents extends UserEventMap> {
    emit<TType extends keyof UserEmitEventMap<TUserEvents> & string>(
        type: TType,
        data: UserEmitEventMap<TUserEvents>[TType]
    ): void;
    readonly flow: FlowInfo;
    readonly log: Logger;
    readonly params: TParams;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly state: StateStore<TState>;
    stop(reason?: string): never;
}

export interface CoreTaskContext<TParams, TState extends StateShape, TUserEvents extends UserEventMap>
    extends CoreFlowContext<TParams, TState, TUserEvents> {
    readonly attempt: number;
    readonly task: TaskInfo;
}

export type FlowContext<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> = Simplify<CoreFlowContext<TParams, TState, TUserEvents> & TContext>;

export type TaskContext<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> = Simplify<CoreTaskContext<TParams, TState, TUserEvents> & TContext>;

// ── Handlers & Middleware ────────────────────────────────────────────

export type TaskHandler<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> = (context: TaskContext<TParams, TState, TContext, TUserEvents>) => unknown | Promise<unknown>;

export type MiddlewareNext = () => Promise<void>;

export type Middleware<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> = (context: TaskContext<TParams, TState, TContext, TUserEvents>, next: MiddlewareNext) => void | Promise<void>;

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

export type ErrorResolver<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> = (
    error: Error,
    context: TaskContext<TParams, TState, TContext, TUserEvents>,
    meta: ErrorResolutionMeta
) => ErrorResolution | Promise<ErrorResolution>;

export type TaskErrorResolution<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> = ErrorResolution | ErrorResolver<TParams, TState, TContext, TUserEvents>;

// ── Parallel Options ─────────────────────────────────────────────────

export type MergeResolver<TState extends StateShape> = <TKey extends keyof TState>(
    key: TKey,
    values: readonly TState[TKey][]
) => TState[TKey];

export type MergeStrategy<TState extends StateShape> = "arrays" | "overwrite" | "strict" | MergeResolver<TState>;

export type ParallelContextFork<TContext extends object> = (
    context: TContext,
    meta: ParallelBranchInfo
) => TContext | Promise<TContext>;

export type ParallelContextCleanup<TContext extends object> = (
    context: TContext,
    meta: ParallelBranchInfo
) => void | Promise<void>;

// ── Node Definitions ─────────────────────────────────────────────────

export interface TaskOptions<
    TParams,
    TState extends StateShape,
    TContext extends object,
    TUserEvents extends UserEventMap,
> {
    readonly middleware?: readonly Middleware<TParams, TState, TContext, TUserEvents>[];
    readonly name?: string;
    readonly onError?: TaskErrorResolution<TParams, TState, TContext, TUserEvents>;
    readonly retry?: RetryPolicy;
    readonly timeoutMs?: number;
}

export interface GroupOptions {
    readonly name?: string;
}

export interface ParallelOptions<TState extends StateShape, TContext extends object> extends GroupOptions {
    readonly cleanupContext?: ParallelContextCleanup<TContext>;
    readonly concurrency?: number;
    readonly forkContext?: ParallelContextFork<TContext>;
    readonly merge?: MergeStrategy<TState>;
    readonly mode?: ParallelMode;
}

export interface TaskDefinition<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
> {
    readonly handler: TaskHandler<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>;
    readonly id: string;
    readonly kind: "task";
    readonly middleware: readonly Middleware<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>[];
    readonly name: string;
    readonly onError?: TaskErrorResolution<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>;
    readonly retry?: RetryPolicy;
    readonly timeoutMs?: number;
    readonly [flowNodeToken]?: FlowNodeContextMetadata<TRequiredContext>;
}

export interface GroupDefinition<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
> {
    readonly children: readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[];
    readonly id: string;
    readonly kind: "group";
    readonly name: string;
    readonly [flowNodeToken]?: FlowNodeContextMetadata<TRequiredContext>;
}

export interface ParallelDefinition<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
> {
    readonly children: readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[];
    readonly cleanupContext?: ParallelContextCleanup<Simplify<TBaseContext & TRequiredContext>>;
    readonly concurrency?: number;
    readonly forkContext?: ParallelContextFork<Simplify<TBaseContext & TRequiredContext>>;
    readonly id: string;
    readonly kind: "parallel";
    readonly merge: MergeStrategy<TState>;
    readonly mode: ParallelMode;
    readonly name: string;
    readonly [flowNodeToken]?: FlowNodeContextMetadata<TRequiredContext>;
}

export type FlowNode<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
> =
    | GroupDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>
    | ParallelDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>
    | TaskDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>;

export type ErasedFlowNode<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
> = FlowNode<TParams, TState, TUserEvents, TBaseContext, object>;

// ── Node Required Context Extraction ─────────────────────────────────

type ExtractedNodeMetadata<TNode> = TNode extends {
    readonly [flowNodeToken]?: infer TMeta;
}
    ? TMeta
    : never;

export type NodeRequiredContext<TNode> =
    ExtractedNodeMetadata<TNode> extends infer TReq ? (TReq extends object ? TReq : never) : never;

export type NodesRequiredContext<TNodes extends readonly unknown[]> = Simplify<
    CollapseIntersection<NodeRequiredContext<TNodes[number]>>
>;

// ── Flow Definition ──────────────────────────────────────────────────

export interface FlowHooks<
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
> {
    readonly onComplete?: (
        context: FlowContext<TParams, TState, TBaseContext, TUserEvents>,
        result: RunResult<TState>
    ) => void | Promise<void>;
    readonly onFailure?: (
        context: FlowContext<TParams, TState, TBaseContext, TUserEvents>,
        error: Error
    ) => void | Promise<void>;
    readonly onStart?: (context: FlowContext<TParams, TState, TBaseContext, TUserEvents>) => void | Promise<void>;
    readonly onSuccess?: (
        context: FlowContext<TParams, TState, TBaseContext, TUserEvents>,
        result: CompletedResult<TState>
    ) => void | Promise<void>;
}

export interface FlowBuilderApi<
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
> {
    group<TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[]>(
        id: string,
        children: TNodes,
        options?: GroupOptions
    ): GroupDefinition<TParams, TState, TUserEvents, TBaseContext, NodesRequiredContext<TNodes>>;

    parallel<TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[]>(
        id: string,
        children: TNodes,
        options?: ParallelOptions<TState, Simplify<TBaseContext & NodesRequiredContext<TNodes>>>
    ): ParallelDefinition<TParams, TState, TUserEvents, TBaseContext, NodesRequiredContext<TNodes>>;

    task<TRequiredContext extends object = {}>(
        id: string,
        handler: TaskHandler<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>,
        options?: TaskOptions<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>
    ): TaskDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>;
}

export interface FlowDefinition<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
> {
    readonly hooks: FlowHooks<TParams, TState, TBaseContext, TUserEvents>;
    readonly id: string;
    readonly initialState?: TState | (() => TState);
    readonly middleware: readonly Middleware<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>[];
    readonly name: string;
    readonly nodes: readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[];
    readonly [flowDefinitionToken]?: FlowTypeMetadata<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>;
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

// ── Extension ────────────────────────────────────────────────────────

export type EmptyEventMap = {};

export interface ExtensionCreateInfo<TExtensionEvents extends UserEventMap> {
    emit<TType extends keyof TExtensionEvents & string>(type: TType, data: TExtensionEvents[TType]): void;
    readonly flow: FlowInfo;
    readonly params: unknown;
    readonly runId: string;
    readonly signal: AbortSignal;
}

export interface Extension<TContext extends object, TEvents extends UserEventMap = EmptyEventMap> {
    create(info: ExtensionCreateInfo<TEvents>): TContext | Promise<TContext>;
    dispose?(context: TContext): void | Promise<void>;
}

export type AnyExtension = Extension<any, any>;

export type AnyFlowDefinition = FlowDefinition<any, any, any, any, any>;

export type ExtensionContext<T> = T extends Extension<infer TCtx, any> ? TCtx : never;
export type ExtensionEvents<T> = T extends Extension<any, infer TEvt> ? TEvt : never;

export type ExtensionContextMap<T extends readonly AnyExtension[]> = Simplify<
    CollapseIntersection<ExtensionContext<T[number]>>
>;

export type ExtensionEventMap<T extends readonly AnyExtension[]> = [ExtensionEvents<T[number]>] extends [never]
    ? EmptyEventMap
    : Simplify<CollapseIntersection<ExtensionEvents<T[number]>>> & UserEventMap;

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

export interface FlowEngineOptions<TUserEvents extends UserEventMap, TExtensions extends readonly AnyExtension[]> {
    readonly extensions?: TExtensions;
    readonly onSubscriberError?: (error: Error, type: string) => void;
    readonly subscribers?: readonly EventSubscriber<EngineEventMap<TUserEvents, ExtensionEventMap<TExtensions>>>[];
}

// ── Flow Compatibility ───────────────────────────────────────────────

type FlowDefinitionMetadata<TFlow> = TFlow extends {
    readonly [flowDefinitionToken]?: infer TMeta;
}
    ? TMeta
    : never;

export type FlowRequiredContext<TFlow> =
    FlowDefinitionMetadata<TFlow> extends FlowTypeMetadata<
        unknown,
        StateShape,
        UserEventMap,
        infer TBaseCtx,
        infer TReqCtx
    >
        ? Simplify<TBaseCtx & TReqCtx>
        : never;

export type FlowUserEvents<TFlow> =
    FlowDefinitionMetadata<TFlow> extends FlowTypeMetadata<unknown, StateShape, infer TEvt, object, object>
        ? TEvt
        : never;

export type FlowParams<TFlow> =
    FlowDefinitionMetadata<TFlow> extends FlowTypeMetadata<infer TParams, StateShape, UserEventMap, object, object>
        ? TParams
        : never;

export type FlowState<TFlow> =
    FlowDefinitionMetadata<TFlow> extends FlowTypeMetadata<unknown, infer TState, UserEventMap, object, object>
        ? TState
        : never;

type FlowCompatibilityGuard<TFlow, TUserEvents extends UserEventMap, TAvailableContext extends object> =
    TAvailableContext extends FlowRequiredContext<TFlow>
        ? TUserEvents extends FlowUserEvents<TFlow>
            ? unknown
            : never
        : never;

export type CompatibleFlow<
    TFlow extends AnyFlowDefinition,
    TUserEvents extends UserEventMap,
    TAvailableContext extends object,
> = TFlow & FlowCompatibilityGuard<TFlow, TUserEvents, TAvailableContext>;
