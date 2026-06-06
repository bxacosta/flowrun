/** biome-ignore-all lint/performance/noBarrelFile: public library entry point */

// Re-exported core types users typically need
export type {
    EventEnvelope,
    EventSubscriber,
    FlowEngineError,
    FlowHandle,
    FlowResult,
    FlowStatus,
    Logger,
    PayloadOf,
} from "@flowrun/core";
// Re-exported Playwright types users will see in handler signatures
export type {
    Browser,
    BrowserContext,
    BrowserContextOptions,
    Frame,
    Locator,
    Page,
} from "playwright-core";
export type { BrowserShape, NewPageOptions, NewSessionOptions } from "./api/define.ts";
// Resource factories (used as the `resource:` field of parallel/every nodes)
export { resource } from "./api/define.ts";
export type { BrowserEngine, CreateBrowserEngineConfig } from "./api/engine.ts";
// Engine
export { createBrowserEngine } from "./api/engine.ts";
// Contracts
export type { BrowserProvider, BrowserSession, OpenOptions } from "./contracts/provider.ts";
export type { LocatorScope, SelectorDefinition, SelectorRegistry } from "./contracts/selectors.ts";
export type {
    StorageListPage,
    StorageLocation,
    StorageLocationKind,
    StorageObjectInfo,
    StorageProvider,
    StorageResult,
} from "./contracts/storage.ts";
export type { BrowserSessionPhase, StorageOperation } from "./errors.ts";
// Errors
export {
    BrowserError,
    BrowserProviderDisposedError,
    BrowserSessionError,
    NavigationError,
    SelectorNotFoundError,
    StorageError,
} from "./errors.ts";
// Extension factories + types
export type { BrowserExtensionDefinition } from "./extension/browser/index.ts";
export type {
    BranchMeta,
    BrowserEmit,
    BrowserEvent,
    BrowserExtensionConfig,
    BrowserProvidedContext,
    CancelStrategy,
    ConsoleLocation,
    NavigateFn,
    NavigateOptions,
    NavigateWaitUntil,
} from "./extension/browser/types.ts";
// Event tokens (subscribe via engine.events.on(token, ...))
export { browserEvents } from "./extension/browser/types.ts";
export type { SelectorsExtensionDefinition } from "./extension/selectors/index.ts";
export { createSelectorsExtension as selectors } from "./extension/selectors/index.ts";
export type {
    SelectorsExtensionConfig,
    SelectorsProvidedContext,
    SelectorsShape,
    WithSelectors,
} from "./extension/selectors/types.ts";
export type { StorageExtensionDefinition } from "./extension/storage/index.ts";
export { createStorageExtension as storage } from "./extension/storage/index.ts";
export type {
    StorageEmit,
    StorageEvent,
    StorageExtensionConfig,
    StorageProvidedContext,
    StorageShape,
    WithStorage,
} from "./extension/storage/types.ts";
export { storageEvents } from "./extension/storage/types.ts";
export type { TracingExtensionDefinition } from "./extension/tracing/index.ts";
export { createTracingExtension as tracing } from "./extension/tracing/index.ts";
export type {
    TraceMode,
    TraceReason,
    TracingEmit,
    TracingEvent,
    TracingExtensionConfig,
    TracingRequiredContext,
    TracingShape,
    WithTracing,
} from "./extension/tracing/types.ts";
export { tracingEvents } from "./extension/tracing/types.ts";
export type { LocalLaunchOptions } from "./providers/local.ts";
// Reference implementations
export { LocalBrowserProvider } from "./providers/local.ts";
export { JsonSelectorRegistry } from "./selectors/json.ts";
export { FileStorageProvider } from "./storage/file.ts";
