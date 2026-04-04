// ── Primitives ────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: EventMap must accept any payload type to serve as an open generic constraint
export type EventMap = Record<string, any>;
export type AsEventMap<T> = { [K in keyof T & string]: T[K] };
export type EmptyObject = Record<never, never>;

// ── Envelope ──────────────────────────────────────────────────────────

export interface Envelope<TPayload = unknown> {
    correlationId?: string;
    id: string;
    payload: TPayload;
    source: string;
    timestamp: number;
    topic: string;
}

export interface SubscribeOptions<TPayload = unknown> {
    filter?: (envelope: Envelope<TPayload>) => boolean;
    once?: boolean;
    priority?: number;
    subscriberId?: string;
}

export type Handler<TPayload> = (envelope: Envelope<TPayload>) => void | Promise<void>;

// ── Subscription ──────────────────────────────────────────────────────

export interface Subscription {
    subscriberId: string;
    topic: string;
    unsubscribe: () => void;
}

// ── Bus Interfaces ────────────────────────────────────────────────────

export interface ReadableBus<TAllEvents extends EventMap> {
    history(topic?: string): Envelope[];
    on(pattern: string, handler: Handler<unknown>, options?: SubscribeOptions): Subscription;
    subscribe<K extends keyof TAllEvents & string>(
        topic: K,
        handler: Handler<TAllEvents[K]>,
        options?: SubscribeOptions<TAllEvents[K]>
    ): Subscription;
    waitFor<K extends keyof TAllEvents & string>(
        topic: K,
        options?: { filter?: (envelope: Envelope<TAllEvents[K]>) => boolean; timeout?: number }
    ): Promise<Envelope<TAllEvents[K]>>;
}

export interface PublishableBus<TPublicEvents extends EventMap, TAllEvents extends EventMap>
    extends ReadableBus<TAllEvents> {
    publish<K extends keyof TPublicEvents & string>(
        topic: K,
        payload: TPublicEvents[K],
        options?: { correlationId?: string; source?: string }
    ): Promise<void>;
}

// ── System Events ─────────────────────────────────────────────────────

export interface SystemInternalEvents {
    "flow:end": {
        duration: number;
        error?: Error;
        flowId: string;
        reason?: string;
        runId: string;
        status: "cancelled" | "failed" | "success";
    };
    "flow:paused": { flowId: string; runId: string };
    "flow:resumed": { flowId: string; runId: string };
    "flow:start": { flowId: string; runId: string };
    "node:every:end": {
        duration: number;
        errors?: Error[];
        failedIndexes?: number[];
        flowId: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
        totalItems: number;
    };
    "node:every:start": { flowId: string; nodeName: string; runId: string; totalItems: number };
    "node:parallel:end": {
        duration: number;
        errors?: Error[];
        flowId: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
    };
    "node:parallel:start": { flowId: string; nodeName: string; runId: string };
    "node:task:attempt:end": {
        attempt: number;
        duration: number;
        error?: Error;
        flowId: string;
        index?: number;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
    };
    "node:task:attempt:start": {
        attempt: number;
        flowId: string;
        index?: number;
        nodeName: string;
        runId: string;
    };
    "node:task:end": {
        attempts: number;
        duration: number;
        error?: Error;
        flowId: string;
        index?: number;
        nodeName: string;
        runId: string;
        status: "failed" | "skipped" | "success";
    };
    "node:task:retry": {
        attempt: number;
        error: Error;
        flowId: string;
        index?: number;
        nextDelayMs: number;
        nodeName: string;
        runId: string;
    };
    "node:task:start": { flowId: string; index?: number; maxAttempts: number; nodeName: string; runId: string };
}

export interface SystemPublicEvents {
    "log:debug": { data?: unknown; flowId: string; message: string; runId: string };
    "log:error": { data?: unknown; flowId: string; message: string; runId: string };
    "log:info": { data?: unknown; flowId: string; message: string; runId: string };
    "log:warn": { data?: unknown; flowId: string; message: string; runId: string };
}

export type AllSystemEvents = SystemInternalEvents & SystemPublicEvents;

// ── Logger ────────────────────────────────────────────────────────────

export interface Logger {
    debug(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
}

// ── Execution Types ──────────────────────────────────────────────────

export type TaskErrorMode = "fail" | "skip";
export type ContainerErrorMode = "continue" | "fail-fast";
export type MergeStrategy = "append" | "overwrite" | "strict";

// ── Retry ────────────────────────────────────────────────────────────

export type BackoffStrategy = "constant" | "exponential";

export type RetryOptions =
    | {
          attempts: number;
          backoff: "constant";
          delayMs: number;
          /**
           * When true, applies equal jitter: the actual delay is randomized
           * between delayMs/2 and delayMs. Desynchronizes concurrent retries
           * without collapsing the delay to trivial values.
           */
          jitter?: boolean;
          maxDelayMs?: number;
          retryOn?: (error: unknown, attempt: number) => boolean;
      }
    | {
          attempts: number;
          backoff: "exponential";
          delayMs: number;
          factor?: number;
          jitter?: boolean;
          maxDelayMs?: number;
          retryOn?: (error: unknown, attempt: number) => boolean;
      };

// ── State Store ──────────────────────────────────────────────────────

export interface FlowStateStore<TState extends Record<string, unknown>> {
    fork(label: number | string): FlowStateStore<TState>;
    get<K extends keyof TState & string>(key: K): TState[K] | undefined;
    getWrittenValues(): Map<string, unknown>;
    has<K extends keyof TState & string>(key: K): boolean;
    patch(values: Partial<TState>): void;
    set<K extends keyof TState & string>(key: K, value: TState[K]): void;
    snapshot(): Readonly<TState>;
}

// ── Iteration Context ────────────────────────────────────────────────

export interface IterationContext<TItem> {
    index: number;
    item: TItem;
}

// ── Middleware ────────────────────────────────────────────────────────

export type Middleware<TContext> = (context: TContext, next: () => Promise<void>) => Promise<void> | void;

// ── Context Publish ──────────────────────────────────────────────────

type DomainEvents<TPublicEvents extends EventMap> = Omit<TPublicEvents, keyof SystemPublicEvents>;

type ContextPublish<TPublicEvents extends EventMap> = <K extends keyof DomainEvents<TPublicEvents> & string>(
    topic: K,
    payload: DomainEvents<TPublicEvents>[K],
    options?: { correlationId?: string; source?: string }
) => void;

// ── Base Context ─────────────────────────────────────────────────────

export type BaseContext<
    TProvided extends Record<string, unknown> = Record<string, unknown>,
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TState extends Record<string, unknown> = Record<string, unknown>,
    TPublicEvents extends EventMap = EventMap,
    TAllEvents extends EventMap = EventMap,
> = {
    bus: PublishableBus<TPublicEvents, TAllEvents>;
    flowId: string;
    log: Logger;
    params: Readonly<TParams>;
    publish: ContextPublish<TPublicEvents>;
    runId: string;
    signal: AbortSignal;
    state: FlowStateStore<TState>;
} & TProvided;

// ── Flow Context ─────────────────────────────────────────────────────

export type FlowContext<
    TProvided extends Record<string, unknown> = Record<string, unknown>,
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TState extends Record<string, unknown> = Record<string, unknown>,
    TPublicEvents extends EventMap = EventMap,
    TAllEvents extends EventMap = EventMap,
> = BaseContext<TProvided, TParams, TState, TPublicEvents, TAllEvents>;

export type FlowMiddleware<
    TProvided extends Record<string, unknown> = Record<string, unknown>,
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TState extends Record<string, unknown> = Record<string, unknown>,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = AllSystemEvents,
> = Middleware<FlowContext<TProvided, TParams, TState, TPublicEvents, TAllEvents>>;

// ── Task Context ─────────────────────────────────────────────────────

export type TaskContext<
    TProvided extends Record<string, unknown> = Record<string, unknown>,
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TState extends Record<string, unknown> = Record<string, unknown>,
    TPublicEvents extends EventMap = EventMap,
    TAllEvents extends EventMap = EventMap,
    TIteration = never,
> = BaseContext<TProvided, TParams, TState, TPublicEvents, TAllEvents> & {
    attempt: number;
    nodeName: string;
} & ([TIteration] extends [never] ? EmptyObject : { readonly iteration: TIteration });

export type TaskMiddleware<
    TProvided extends Record<string, unknown> = Record<string, unknown>,
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TState extends Record<string, unknown> = Record<string, unknown>,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = AllSystemEvents,
    TIteration = never,
> = Middleware<TaskContext<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>>;

// ── Items Context ────────────────────────────────────────────────────

export type ItemsContext<
    TProvided extends Record<string, unknown> = Record<string, unknown>,
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TState extends Record<string, unknown> = Record<string, unknown>,
    TPublicEvents extends EventMap = EventMap,
    TAllEvents extends EventMap = EventMap,
    TIteration = never,
> = BaseContext<TProvided, TParams, TState, TPublicEvents, TAllEvents> &
    ([TIteration] extends [never] ? EmptyObject : { readonly iteration: TIteration });

// ── Fork Meta ────────────────────────────────────────────────────────

export interface EveryForkMeta {
    index: number;
    item: unknown;
    nodeName: string;
}

export interface ParallelForkMeta {
    branchIndex: number;
    branchName: string;
    nodeName: string;
}

// ── Node Definitions ─────────────────────────────────────────────────

export interface TaskNodeDefinition {
    handler: AnyTaskHandler;
    middleware: AnyMiddleware[];
    name: string;
    onError: TaskErrorMode;
    retry?: RetryOptions;
    type: "task";
}

export interface ParallelNodeDefinition {
    children: NodeDefinition[];
    cleanupProvided?: AnyCleanupProvided;
    forkProvided?: AnyForkProvided;
    merge: MergeStrategy;
    name: string;
    onError: ContainerErrorMode;
    type: "parallel";
}

export interface EveryNodeDefinition {
    children: NodeDefinition[];
    cleanupProvided?: AnyCleanupProvided;
    concurrency: number;
    forkProvided?: AnyForkProvided;
    items: AnyItemsFunction;
    merge: MergeStrategy;
    name: string;
    onError: ContainerErrorMode;
    type: "every";
}

export type NodeDefinition = EveryNodeDefinition | ParallelNodeDefinition | TaskNodeDefinition;

// ── Node Builder ─────────────────────────────────────────────────────

export interface TaskNodeConfig<
    TProvided extends Record<string, unknown>,
    TParams extends Record<string, unknown>,
    TState extends Record<string, unknown>,
    TPublicEvents extends EventMap,
    TAllEvents extends EventMap,
    TIteration = never,
> {
    handler: (
        context: TaskContext<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>
    ) => Promise<void> | void;
    name: string;
    options?: {
        middleware?: NoInfer<TaskMiddleware<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>>[];
        onError?: TaskErrorMode;
        retry?: RetryOptions;
    };
}

export interface ParallelNodeConfig<
    TProvided extends Record<string, unknown>,
    TParams extends Record<string, unknown>,
    TState extends Record<string, unknown>,
    TPublicEvents extends EventMap,
    TAllEvents extends EventMap,
    TIteration = never,
> {
    children: (
        builder: NodeBuilder<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>
    ) => NodeDefinition[];
    name: string;
    options?: {
        cleanupProvided?: (
            provided: TProvided,
            meta: { branchIndex: number; branchName: string; nodeName: string }
        ) => void | Promise<void>;
        forkProvided?: (
            provided: TProvided,
            meta: { branchIndex: number; branchName: string; nodeName: string }
        ) => TProvided | Promise<TProvided>;
        merge?: MergeStrategy;
        onError?: ContainerErrorMode;
    };
}

export interface EveryNodeConfig<
    TProvided extends Record<string, unknown>,
    TParams extends Record<string, unknown>,
    TState extends Record<string, unknown>,
    TPublicEvents extends EventMap,
    TAllEvents extends EventMap,
    TItem,
    TIteration = never,
> {
    children: (
        builder: NodeBuilder<TProvided, TParams, TState, TPublicEvents, TAllEvents, IterationContext<TItem>>
    ) => NodeDefinition[];
    items: (context: ItemsContext<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>) => TItem[];
    name: string;
    options?: {
        cleanupProvided?: (
            provided: TProvided,
            meta: { index: number; item: TItem; nodeName: string }
        ) => void | Promise<void>;
        concurrency?: number;
        forkProvided?: (
            provided: TProvided,
            meta: { index: number; item: TItem; nodeName: string }
        ) => TProvided | Promise<TProvided>;
        merge?: MergeStrategy;
        onError?: ContainerErrorMode;
    };
}

export interface NodeBuilder<
    TProvided extends Record<string, unknown>,
    TParams extends Record<string, unknown>,
    TState extends Record<string, unknown>,
    TPublicEvents extends EventMap,
    TAllEvents extends EventMap,
    TIteration = never,
> {
    every<TItem>(
        config: EveryNodeConfig<TProvided, TParams, TState, TPublicEvents, TAllEvents, TItem, TIteration>
    ): NodeDefinition;

    parallel(
        config: ParallelNodeConfig<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>
    ): NodeDefinition;

    task(config: TaskNodeConfig<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>): NodeDefinition;
}

// ── Flow Definition ──────────────────────────────────────────────────

export interface FlowDefinition<
    TProvided extends Record<string, unknown>,
    TParams extends Record<string, unknown>,
    TState extends Record<string, unknown>,
    TPublicEvents extends EventMap,
    TAllEvents extends EventMap,
> {
    middleware?: NoInfer<FlowMiddleware<TProvided, TParams, TState, TPublicEvents, TAllEvents>>[];
    nodes: (builder: NodeBuilder<TProvided, TParams, TState, TPublicEvents, TAllEvents>) => NodeDefinition[];
    state?: (params: Readonly<TParams>) => TState;
}

// ── Flow ─────────────────────────────────────────────────────────────

export type RunStatus = "cancelled" | "completed" | "failed" | "paused" | "running";

export interface FlowHandle<TState extends Record<string, unknown>> {
    cancel(reason?: string): void;
    readonly flowId: string;
    join(): Promise<FlowResult<TState>>;
    pause(): void;
    resume(): void;
    readonly runId: string;
    status(): RunStatus;
}

export interface Flow<TParams extends Record<string, unknown>, TState extends Record<string, unknown>> {
    id: string;
    run(...args: RunArgs<TParams>): Promise<FlowResult<TState>>;
    start(...args: RunArgs<TParams>): Promise<FlowHandle<TState>>;
}

// ── Task Result ──────────────────────────────────────────────────────

export interface TaskRunResult {
    attempts: number;
    duration: number;
    error?: Error;
    iteration?: { index: number; item: unknown };
    nodeName: string;
    path: string;
    status: "failed" | "skipped" | "success";
}

// ── Flow Result ───────────────────────────────────────────────────────

export interface BaseFlowResult<TState extends Record<string, unknown>> {
    duration: number;
    flowId: string;
    runId: string;
    state: Readonly<TState>;
    tasks: readonly TaskRunResult[];
}

export interface SuccessFlowResult<TState extends Record<string, unknown>> extends BaseFlowResult<TState> {
    status: "success";
}

export interface FailedFlowResult<TState extends Record<string, unknown>> extends BaseFlowResult<TState> {
    error: Error;
    status: "failed";
}

export interface CancelledFlowResult<TState extends Record<string, unknown>> extends BaseFlowResult<TState> {
    reason?: string;
    status: "cancelled";
}

export type FlowResult<TState extends Record<string, unknown>> =
    | CancelledFlowResult<TState>
    | FailedFlowResult<TState>
    | SuccessFlowResult<TState>;

// ── Type-Level Helpers ────────────────────────────────────────────────

export type MergeAllEvents<
    TCurrentAll extends EventMap,
    TExtensionInternal extends object,
    TExtensionPublic extends object,
> = TCurrentAll & AsEventMap<TExtensionInternal> & AsEventMap<TExtensionPublic>;

export type MergePublicEvents<TCurrentPublic extends EventMap, TExtensionPublic extends object> = TCurrentPublic &
    AsEventMap<TExtensionPublic>;

export type RunArgs<TParams> = keyof TParams extends never ? [params?: TParams] : [params: TParams];

// ── Type-Erased Aliases ─────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: type-erased cleanup callback — typed at EveryNodeConfig/ParallelNodeConfig boundary
export type AnyCleanupProvided = (provided: any, meta: any) => void | Promise<void>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased envelope for untyped dispatch contexts
export type AnyEnvelope = Envelope<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow — public Flow interface provides type safety
export type AnyFlow = Flow<any, any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased fork callback — typed at EveryNodeConfig/ParallelNodeConfig boundary
export type AnyForkProvided = (provided: any, meta: any) => any;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow definition — typed at engine.flow() boundary
export type AnyFlowDefinition = FlowDefinition<any, any, any, any, any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow handle — typed at Flow.start() return
export type AnyFlowHandle = FlowHandle<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow result — typed at Flow.run() return
export type AnyFlowResult = FlowResult<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased state store — typed at FlowDefinition boundary
export type AnyFlowStateStore = FlowStateStore<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased handler for heterogeneous handler storage
export type AnyHandler = Handler<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased items function — typed at NodeBuilder.every() boundary
export type AnyItemsFunction = (context: any) => unknown[];

// biome-ignore lint/suspicious/noExplicitAny: type-erased middleware — typed at FlowDefinition/TaskNodeConfig boundary
export type AnyMiddleware = Middleware<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased node builder — public NodeBuilder interface provides type safety
export type AnyNodeBuilder = NodeBuilder<any, any, any, any, any, any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased publishable bus for narrow() view restriction
export type AnyPublishableBus = PublishableBus<any, any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased run arguments — typed at .run() boundary
export type AnyRunArgs = [params?: any];

// biome-ignore lint/suspicious/noExplicitAny: type-erased subscribe options — typed at ReadableBus.subscribe boundary
export type AnySubscribeOptions = SubscribeOptions<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased task handler for heterogeneous node storage
export type AnyTaskHandler = (context: any) => Promise<void> | void;
