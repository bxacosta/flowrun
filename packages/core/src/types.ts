import type { Handler, PublishableBus, SubscribeOptions } from "./event-bus.ts";
import type { AllSystemEvents, Envelope, EventMap, SystemPublicEvents } from "./events.ts";
import type { Logger } from "./logger.ts";

// ── Primitives ────────────────────────────────────────────────────────

export type EmptyObject = Record<never, never>;

// ── Execution Modes ──────────────────────────────────────────────────

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
    get<K extends keyof TState & string>(key: K): TState[K];
    getWrittenValues(): Map<string, unknown>;
    has<K extends keyof TState & string>(key: K): boolean;
    patch(values: Partial<TState>): void;
    set<K extends keyof TState & string>(key: K, value: TState[K]): void;
    snapshot(): Readonly<TState>;
}

// ── Iteration ────────────────────────────────────────────────────────

export interface IterationContext<TItem> {
    index: number;
    item: TItem;
}

// ── Scope ────────────────────────────────────────────────────────────

export interface Scope<
    TProvided extends Record<string, unknown> = EmptyObject,
    TParams extends Record<string, unknown> = EmptyObject,
    TState extends Record<string, unknown> = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = AllSystemEvents,
    TIteration = never,
> {
    readonly _allEvents: TAllEvents;
    readonly _iteration: TIteration;
    readonly _params: TParams;
    readonly _provided: TProvided;
    readonly _publicEvents: TPublicEvents;
    readonly _state: TState;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased scope reference
export type AnyScope = Scope<any, any, any, any, any, any>;

export type EachScope<TScope extends AnyScope, TItem> = Scope<
    TScope["_provided"],
    TScope["_params"],
    TScope["_state"],
    TScope["_publicEvents"],
    TScope["_allEvents"],
    IterationContext<TItem>
>;

// ── Node (branded by Scope) ──────────────────────────────────────────

export type Node<TScope extends AnyScope = AnyScope> = NodeDefinition & {
    readonly _scope?: TScope;
};

// ── Middleware ───────────────────────────────────────────────────────

export type Middleware<TContext> = (context: TContext, next: () => Promise<void>) => Promise<void> | void;

// ── Context Publish (filters out system events) ──────────────────────

type DomainEvents<TPublicEvents extends EventMap> = Omit<TPublicEvents, keyof SystemPublicEvents>;

type ContextPublish<TPublicEvents extends EventMap> = <K extends keyof DomainEvents<TPublicEvents> & string>(
    topic: K,
    payload: DomainEvents<TPublicEvents>[K],
    options?: { correlationId?: string; source?: string }
) => void;

// ── Contexts (single TScope parameter) ───────────────────────────────

type IterationField<TIteration> = [TIteration] extends [never] ? EmptyObject : { readonly iteration: TIteration };

// Structural source of truth. Takes individual scope fields as generic params
// so per-field variance is preserved when used in slot positions.
type BaseContextOf<
    TProvided extends Record<string, unknown> = EmptyObject,
    TParams extends Record<string, unknown> = EmptyObject,
    TState extends Record<string, unknown> = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = AllSystemEvents,
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

type TaskExtras<TIteration = never> = {
    attempt: number;
    nodeName: string;
} & IterationField<TIteration>;

export type BaseContext<TScope extends AnyScope = Scope> = BaseContextOf<
    TScope["_provided"],
    TScope["_params"],
    TScope["_state"],
    TScope["_publicEvents"],
    TScope["_allEvents"]
>;

export type FlowContext<TScope extends AnyScope = Scope> = BaseContext<TScope>;

export type TaskContext<TScope extends AnyScope = Scope> = BaseContext<TScope> & TaskExtras<TScope["_iteration"]>;

export type ItemsContext<TScope extends AnyScope = Scope> = BaseContext<TScope> & IterationField<TScope["_iteration"]>;

// Slot-position helpers parameterized by individual scope fields so per-field
// variance is preserved at config sites (universal Middleware<FlowContext>
// stays assignable to a Middleware<FlowContext<OrderScope>> slot).
type FlowMiddlewareSlot<
    TProvided extends Record<string, unknown> = EmptyObject,
    TParams extends Record<string, unknown> = EmptyObject,
    TState extends Record<string, unknown> = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = AllSystemEvents,
> = Middleware<BaseContextOf<TProvided, TParams, TState, TPublicEvents, TAllEvents>>;

type TaskMiddlewareSlot<
    TProvided extends Record<string, unknown> = EmptyObject,
    TParams extends Record<string, unknown> = EmptyObject,
    TState extends Record<string, unknown> = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = AllSystemEvents,
    TIteration = never,
> = Middleware<BaseContextOf<TProvided, TParams, TState, TPublicEvents, TAllEvents> & TaskExtras<TIteration>>;

// ── Fork Meta ────────────────────────────────────────────────────────

export interface ParallelForkMeta {
    branchIndex: number;
    branchName: string;
    nodeName: string;
}

export interface EveryForkMeta<TItem = unknown> {
    index: number;
    item: TItem;
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

// ── ChildrenSpec ─────────────────────────────────────────────────────

export type ChildrenSpec<TScope extends AnyScope> =
    | readonly Node<TScope>[]
    | ((builder: NodeBuilder<TScope>) => readonly Node<TScope>[]);

// ── Configs ──────────────────────────────────────────────────────────

export interface TaskConfig<TScope extends AnyScope> {
    handler: (context: TaskContext<TScope>) => Promise<void> | void;
    middleware?: NoInfer<
        TaskMiddlewareSlot<
            TScope["_provided"],
            TScope["_params"],
            TScope["_state"],
            TScope["_publicEvents"],
            TScope["_allEvents"],
            TScope["_iteration"]
        >
    >[];
    name: string;
    onError?: TaskErrorMode;
    retry?: RetryOptions;
}

export interface ParallelOptions<TScope extends AnyScope> {
    cleanupProvided?: (provided: TScope["_provided"], meta: ParallelForkMeta) => void | Promise<void>;
    forkProvided?: (
        provided: TScope["_provided"],
        meta: ParallelForkMeta
    ) => TScope["_provided"] | Promise<TScope["_provided"]>;
    merge?: MergeStrategy;
    onError?: ContainerErrorMode;
}

export type ParallelConfig<TScope extends AnyScope> = ParallelOptions<TScope> & {
    children: ChildrenSpec<TScope>;
    name: string;
};

export interface EveryOptions<TScope extends AnyScope, TItem> {
    cleanupProvided?: (provided: TScope["_provided"], meta: EveryForkMeta<TItem>) => void | Promise<void>;
    concurrency?: number;
    forkProvided?: (
        provided: TScope["_provided"],
        meta: EveryForkMeta<TItem>
    ) => TScope["_provided"] | Promise<TScope["_provided"]>;
    merge?: MergeStrategy;
    onError?: ContainerErrorMode;
}

export type EveryConfig<TScope extends AnyScope, TItem> = EveryOptions<TScope, TItem> & {
    children: ChildrenSpec<EachScope<TScope, TItem>>;
    items: (context: ItemsContext<TScope>) => TItem[];
    name: string;
};

// ── Node Builder ─────────────────────────────────────────────────────

export interface NodeBuilder<TScope extends AnyScope> {
    every<TItem>(config: EveryConfig<TScope, TItem>): Node<TScope>;
    parallel(config: ParallelConfig<TScope>): Node<TScope>;
    task(config: TaskConfig<TScope>): Node<TScope>;
}

// ── Flow Definition ──────────────────────────────────────────────────

type FlowStateFieldOf<
    TParams extends Record<string, unknown>,
    TState extends Record<string, unknown>,
> = keyof TState extends never
    ? { state?: (params: Readonly<TParams>) => TState }
    : { state: (params: Readonly<TParams>) => TState };

export type FlowDefinitionOf<
    TProvided extends Record<string, unknown>,
    TParams extends Record<string, unknown>,
    TState extends Record<string, unknown>,
    TPublicEvents extends EventMap,
    TAllEvents extends EventMap,
> = {
    middleware?: NoInfer<FlowMiddlewareSlot<TProvided, TParams, TState, TPublicEvents, TAllEvents>>[];
    nodes: NoInfer<ChildrenSpec<Scope<TProvided, TParams, TState, TPublicEvents, TAllEvents>>>;
} & FlowStateFieldOf<TParams, TState>;

export type FlowDefinition<TScope extends AnyScope> = {
    middleware?: NoInfer<
        FlowMiddlewareSlot<
            TScope["_provided"],
            TScope["_params"],
            TScope["_state"],
            TScope["_publicEvents"],
            TScope["_allEvents"]
        >
    >[];
    nodes: ChildrenSpec<TScope>;
} & FlowStateFieldOf<TScope["_params"], TScope["_state"]>;

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

export type RunArgs<TParams> = keyof TParams extends never ? [params?: TParams] : [params: TParams];

// ── Type-Erased Aliases ──────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: type-erased cleanup callback — typed at config boundary
export type AnyCleanupProvided = (provided: any, meta: any) => void | Promise<void>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased envelope for untyped dispatch contexts
export type AnyEnvelope = Envelope<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow — public Flow interface provides type safety
export type AnyFlow = Flow<any, any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased fork callback — typed at config boundary
export type AnyForkProvided = (provided: any, meta: any) => any;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow handle — typed at Flow.start() return
export type AnyFlowHandle = FlowHandle<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow result — typed at Flow.run() return
export type AnyFlowResult = FlowResult<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased state store — typed at FlowDefinition boundary
export type AnyFlowStateStore = FlowStateStore<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased handler for heterogeneous handler storage
export type AnyHandler = Handler<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased items function — typed at EveryConfig boundary
export type AnyItemsFunction = (context: any) => unknown[];

// biome-ignore lint/suspicious/noExplicitAny: type-erased middleware — typed at FlowDefinition/TaskConfig boundary
export type AnyMiddleware = Middleware<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased publishable bus for narrow() view restriction
export type AnyPublishableBus = PublishableBus<any, any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased run arguments — typed at .run() boundary
export type AnyRunArgs = [params?: any];

// biome-ignore lint/suspicious/noExplicitAny: type-erased subscribe options — typed at ReadableBus.subscribe boundary
export type AnySubscribeOptions = SubscribeOptions<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased task handler for heterogeneous node storage
export type AnyTaskHandler = (context: any) => Promise<void> | void;
