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
export type { FlowStatus, Outcome, TerminalFlowStatus } from "./core/status.ts";
export type { EmptyObject, IterationContext, MaybePromise } from "./core/types.ts";
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
    ExtensionConfig,
    ExtensionDefinition,
    ExtensionDispose,
    ExtensionProvided,
    ExtensionRequired,
    ExtensionSetupContext,
    ExtensionSetupResult,
    RequiresMarker,
    UnwrapRequires,
} from "./definition/extension.ts";
export { extension, requires } from "./definition/extension.ts";
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
    BranchMeta,
    ContainerResource,
    EachBranchMeta,
    ErrorMode,
    Node,
    ParallelBranchMeta,
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
    RequestAlreadySettledError,
    RequestCancelledError,
    RequestError,
    RequestExpiredError,
    RequestNotFoundError,
    request,
} from "./definition/request.ts";
export type { ShapeFactory } from "./definition/shape-factory.ts";
export { shape } from "./definition/shape-factory.ts";
export type { Engine, EngineConfig, InferEngine, MissingExtensionDependency } from "./engine/engine.ts";
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
    AnyEventToken,
    EmitFn,
    EmitOptions,
    EventEnvelope,
    EventSource,
    EventSubscriber,
    EventToken,
    LogLevel,
    OnOptions,
    PayloadOf,
    Subscription,
    WaitForOptions,
} from "./events/types.ts";
export { event, systemEvents } from "./events/types.ts";
// ── shape ───────────────────────────────────────────────────────────
export type {
    AnyShape,
    Compose,
    EventsOf,
    IterationOf,
    ParamsOf,
    ProvidedOf,
    Shape,
    StateOf,
} from "./shape/shape.ts";
// ── state ───────────────────────────────────────────────────────────
export { InvalidMergeValueError, MergeConflictError } from "./state/errors.ts";
export type { MergeStrategy, StateStore } from "./state/types.ts";
