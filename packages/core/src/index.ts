/**
 * index.ts — Public API barrel
 *
 * Re-exports the public surface. Layers (low → high): core → shape → events /
 * state → definition → engine.
 */

// ── core ────────────────────────────────────────────────────────────
// biome-ignore lint/performance/noBarrelFile: public library entry point
export { FlowEngineError, normalizeError } from "./core/errors.ts";
export { FlowCancellationSignal, SkipSignal } from "./core/signals.ts";
export type { FlowStatus, TerminalFlowStatus } from "./core/status.ts";
export type { EmptyObject, MaybePromise } from "./core/types.ts";
export {
    DuplicateNodeNameError,
    InvalidNameError,
    InvalidPatternError,
    InvalidPlainObjectError,
    InvalidTopicKeyError,
} from "./core/validation.ts";
// ── definition ──────────────────────────────────────────────────────
export type {
    BaseContext,
    ContainerContext,
    FlowContext,
    TaskContext,
} from "./definition/context-types.ts";
export type {
    EventDefinitions,
    EventMarker,
    ExtensionConfig,
    ExtensionDefinition,
    ExtensionDispose,
    ExtensionEvents,
    ExtensionProvided,
    ExtensionRequired,
    ExtensionSetupContext,
    ExtensionSetupResult,
    FlowOutcome,
    Prefixed,
    RequiresMarker,
    UnwrapEvents,
    UnwrapRequires,
} from "./definition/extension.ts";
export { event, extension, requires } from "./definition/extension.ts";
export type { FlowBuilder, FlowDefinition } from "./definition/flow.ts";
export { flow } from "./definition/flow.ts";
export type {
    FlowMiddleware,
    Middleware,
    MiddlewareConfig,
    MiddlewareRun,
    TaskMiddleware,
} from "./definition/middleware.ts";
export { middleware } from "./definition/middleware.ts";
export type {
    ContainerResource,
    EachMeta,
    ErrorMode,
    Node,
    ParallelMeta,
    ResourceOutcome,
    RetryConfig,
} from "./definition/node.ts";
export type {
    ContainerMeta,
    EachConfig,
    EachConfigWithResource,
    EachOptions,
    EachResourceConfig,
    NodeFactory,
    NodesSpec,
    ParallelConfig,
    ParallelConfigWithResource,
    ParallelOptions,
    ParallelResourceConfig,
    ResourceFactory,
    TaskConfig,
} from "./definition/node-factory.ts";
export type {
    ContextRequest,
    EngineRequests,
    PendingRequest,
    RequestConfig,
    RequestDefinition,
    RequestFilter,
    RequestOptions,
    RequestRecord,
    RequestResponseOptions,
    RequestStatus,
    RequestSubscribeOptions,
    RequestSubscription,
} from "./definition/request.ts";
export {
    RequestAlreadyResolvedError,
    RequestCancelledError,
    RequestError,
    RequestNotFoundError,
    RequestTimeoutError,
    request,
} from "./definition/request.ts";
export type { ShapeFactory } from "./definition/shape-factory.ts";
export { shape } from "./definition/shape-factory.ts";
export type { Engine, EngineConfig, EngineEvents, InferEngine, MissingExtensionDependency } from "./engine/engine.ts";
// ── engine ──────────────────────────────────────────────────────────
export { createEngine, DuplicateExtensionError, DuplicateFlowError, FlowNotRegisteredError } from "./engine/engine.ts";
export { InvalidItemsError } from "./engine/execute.ts";
export type { Flow, FlowHandle, RunArgs } from "./engine/flow-runner.ts";
export type {
    BaseFlowResult,
    CancelledFlowResult,
    FailedFlowResult,
    FlowResult,
    SuccessFlowResult,
    TaskResult,
} from "./engine/results.ts";
// ── events ──────────────────────────────────────────────────────────
export type {
    EventBus,
    EventBusConfig,
    EventBusErrorContext,
    EventBusErrorHandler,
} from "./events/bus.ts";
export { createEventBus } from "./events/bus.ts";
export type { Logger } from "./events/logger.ts";
export type {
    EmitFn,
    EmitOptions,
    EventEnvelope,
    EventMap,
    EventSource,
    EventSubscriber,
    LogLevel,
    OnOptions,
    RuntimeEvents,
    Subscription,
    WaitForOptions,
} from "./events/types.ts";
// ── shape ───────────────────────────────────────────────────────────
export type {
    AnyShape,
    EventsOf,
    IterationContext,
    IterationOf,
    ParamsOf,
    ProvidedOf,
    Shape,
    StateOf,
    WithEvents,
    WithIteration,
    WithParams,
    WithProvided,
    WithState,
} from "./shape/shape.ts";
// ── state ───────────────────────────────────────────────────────────
export { InvalidMergeValueError, MergeConflictError } from "./state/errors.ts";
export type { MergeStrategy, StateStore } from "./state/types.ts";
