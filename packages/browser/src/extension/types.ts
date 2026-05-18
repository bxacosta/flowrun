import type { BrowserProvider, BrowserSession, OpenOptions } from "../contracts/provider.ts";
import type { SelectorRegistry } from "../contracts/selectors.ts";
import type { StorageProvider } from "../contracts/storage.ts";

export type TraceMode = "off" | "on" | "on-failure" | "retain-on-failure";

export type TraceReason = "always" | "on-failure" | "retained";

export interface TraceConfig {
    mode: TraceMode;
    screenshots?: boolean;
    snapshots?: boolean;
    sources?: boolean;
    storageKey?: (context: { runId: string; flowName: string }) => string;
}

export type CancelStrategy = "close-context" | "none";

export interface BrowserExtensionConfig {
    cancelStrategy?: CancelStrategy;
    defaultNavigationTimeout?: number;
    defaultTimeout?: number;
    emitNavigateEvent?: boolean;
    emitStorageEvent?: boolean;
    observeConsoleErrors?: boolean;
    observePageErrors?: boolean;
    openOptions?: OpenOptions;
    provider: BrowserProvider;
    selectors: SelectorRegistry;
    storage: StorageProvider;
    trace?: TraceConfig;
}

export interface ResolvedBrowserExtensionConfig {
    cancelStrategy: CancelStrategy;
    defaultNavigationTimeout: number | undefined;
    defaultTimeout: number | undefined;
    emitNavigateEvent: boolean;
    emitStorageEvent: boolean;
    observeConsoleErrors: boolean;
    observePageErrors: boolean;
    openOptions: OpenOptions | undefined;
    provider: BrowserProvider;
    selectors: SelectorRegistry;
    storage: StorageProvider;
    trace: TraceConfig;
}

export function resolveConfig(config: BrowserExtensionConfig): ResolvedBrowserExtensionConfig {
    return {
        provider: config.provider,
        selectors: config.selectors,
        storage: config.storage,
        openOptions: config.openOptions,
        defaultTimeout: config.defaultTimeout,
        defaultNavigationTimeout: config.defaultNavigationTimeout,
        observePageErrors: config.observePageErrors ?? true,
        observeConsoleErrors: config.observeConsoleErrors ?? true,
        emitNavigateEvent: config.emitNavigateEvent ?? true,
        emitStorageEvent: config.emitStorageEvent ?? true,
        trace: config.trace ?? { mode: "off" },
        cancelStrategy: config.cancelStrategy ?? "close-context",
    };
}

export interface BranchMeta {
    branch?: string;
    iteration?: number;
}

export type NavigateWaitUntil = "commit" | "domcontentloaded" | "load" | "networkidle";

export interface NavigateOptions {
    timeout?: number;
    waitUntil?: NavigateWaitUntil;
}

export type NavigateFn = (url: string, options?: NavigateOptions) => Promise<void>;

export interface BrowserProvidedContext {
    navigate: NavigateFn;
    page: BrowserSession["page"];
    provider: BrowserProvider;
    selectors: SelectorRegistry;
    session: BrowserSession;
    storage: StorageProvider;
}

export interface ConsoleLocation {
    columnNumber: number;
    lineNumber: number;
    url: string;
}

export interface BrowserEventPayloads {
    "browser:closed": Record<string, never>;
    "browser:console-error": { text: string; location?: ConsoleLocation };
    "browser:navigated": { url: string; durationMs: number };
    "browser:opened": Record<string, never>;
    "browser:page-closed": BranchMeta;
    "browser:page-error": { message: string; stack?: string };
    "browser:page-opened": BranchMeta;
    "browser:session-closed": BranchMeta;
    "browser:session-opened": BranchMeta;
    "browser:storage-saved": { key: string; size: number };
    "browser:tracing-saved": { key: string; size: number; reason: TraceReason };
}

export const EVENT_SOURCE = "browser";
