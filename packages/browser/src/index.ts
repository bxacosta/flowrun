/** biome-ignore-all lint/performance/noBarrelFile: public library entry point */

// Re-exported core types users typically need
export type { FlowEngineError, FlowHandle, FlowResult, FlowStatus, Logger } from "@flowrun/core";
// Re-exported Playwright types users will see in handler signatures
export type {
    Browser,
    BrowserContext,
    BrowserContextOptions,
    Frame,
    Locator,
    Page,
} from "playwright-core";
export type { BrowserRootScope, BrowserScope, NewPageOptions, NewSessionOptions } from "./api/define.ts";
// Define namespace
export { browser } from "./api/define.ts";
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
export type { BrowserExtensionDefinition } from "./extension/browser-extension.ts";
// Extension types
export type {
    BrowserEventPayloads,
    BrowserExtensionConfig,
    BrowserProvidedContext,
    CancelStrategy,
    ConsoleLocation,
    NavigateFn,
    NavigateOptions,
    NavigateWaitUntil,
    TraceConfig,
    TraceMode,
    TraceReason,
} from "./extension/types.ts";
export type { LocalLaunchOptions } from "./providers/local.ts";
// Reference implementations
export { LocalBrowserProvider } from "./providers/local.ts";
export { JsonSelectorRegistry } from "./selectors/json.ts";
export { FileStorageProvider } from "./storage/file.ts";
