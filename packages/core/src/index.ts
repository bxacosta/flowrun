// ── Runtime ───────────────────────────────────────────────────────────

// biome-ignore lint/performance/noBarrelFile: public library entry point
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

export type { Engine, FlowTypes, InferEngine } from "./engine.ts";
export type { EventBusConfig, InternalBus } from "./event-bus.ts";

// ── Types: Node System ───────────────────────────────────────────────

export type {
    BackoffStrategy,
    ContainerErrorMode,
    EveryNodeConfig,
    EveryNodeDefinition,
    Flow,
    FlowContext,
    FlowDefinition,
    FlowHandle,
    FlowMiddleware,
    FlowStateStore,
    ItemsContext,
    IterationContext,
    MergeStrategy,
    Middleware,
    NodeBuilder,
    NodeDefinition,
    ParallelNodeConfig,
    ParallelNodeDefinition,
    RetryOptions,
    RunStatus,
    TaskContext,
    TaskErrorMode,
    TaskMiddleware,
    TaskNodeConfig,
    TaskNodeDefinition,
    TaskRunResult,
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

// ── Types: Core ──────────────────────────────────────────────────────

export type {
    AllSystemEvents,
    AsEventMap,
    BaseContext,
    BaseFlowResult,
    CancelledFlowResult,
    EmptyObject,
    Envelope,
    EventMap,
    FailedFlowResult,
    FlowResult,
    Handler,
    Logger,
    MergeAllEvents,
    MergePublicEvents,
    PublishableBus,
    ReadableBus,
    RunArgs,
    SubscribeOptions,
    Subscription,
    SuccessFlowResult,
    SystemInternalEvents,
    SystemPublicEvents,
} from "./types.ts";
