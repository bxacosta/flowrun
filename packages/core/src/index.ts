// ── Runtime ───────────────────────────────────────────────────────────

// biome-ignore lint/performance/noBarrelFile: public library entry point
export { defineEvery, defineFlow, defineParallel, defineTask } from "./define.ts";
export { createEngine } from "./engine.ts";
export {
    DuplicateNodeNameError,
    FlowEngineError,
    InvalidItemsError,
    InvalidMergeValueError,
    MergeConflictError,
    normalizeError,
} from "./errors.ts";
export { createEventBus } from "./event-bus.ts";
export { defineExtension, event, internal } from "./extension.ts";

// ── Types: Engine & Flow ─────────────────────────────────────────────

export type { Engine, EngineEvents, FlowScope, InferEngine } from "./engine.ts";
export type {
    EventBusConfig,
    Handler,
    InternalBus,
    PublishableBus,
    ReadableBus,
    SubscribeOptions,
    Subscription,
} from "./event-bus.ts";
export type {
    AsEventMap,
    Envelope,
    EventMap,
    LogEventPayload,
    LogLevel,
    MergeAllEvents,
    MergePublicEvents,
    SystemEvents,
    SystemInternalEvents,
    SystemPublicEvents,
} from "./events.ts";

// ── Types: Scope & Nodes ─────────────────────────────────────────────

export type {
    AnyScope,
    BackoffStrategy,
    BaseContext,
    ContainerErrorMode,
    EachScope,
    EveryConfig,
    EveryForkMeta,
    EveryNodeDefinition,
    EveryOptions,
    Flow,
    FlowContext,
    FlowDefinition,
    FlowHandle,
    FlowStateStore,
    FlowStatus,
    ItemsContext,
    IterationContext,
    MergeStrategy,
    Middleware,
    Node,
    NodeBuilder,
    NodeDefinition,
    NodesSpec,
    ParallelConfig,
    ParallelForkMeta,
    ParallelNodeDefinition,
    ParallelOptions,
    RetryOptions,
    Scope,
    TaskConfig,
    TaskContext,
    TaskErrorMode,
    TaskNodeDefinition,
    TaskResult,
} from "./types.ts";

// ── Types: Extension System ──────────────────────────────────────────

export type {
    Event,
    EventDefinitions,
    EventMarker,
    Extension,
    ExtensionConfig,
    ExtensionContext,
    ExtractInternalEvents,
    ExtractPublicEvents,
    Internal,
    UnwrapEvents,
} from "./extension.ts";

// ── Types: Logger ──────────────────────────────────────────────────────

export type { Logger } from "./logger.ts";

// ── Types: Core ──────────────────────────────────────────────────────

export type {
    BaseFlowResult,
    CancelledFlowResult,
    EmptyObject,
    FailedFlowResult,
    FlowResult,
    RunArgs,
    SuccessFlowResult,
} from "./types.ts";
