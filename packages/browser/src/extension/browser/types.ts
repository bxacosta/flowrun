import type { EventMap, PublishableBus } from "@flowrun/core";

import type { BrowserProvider, BrowserSession, OpenOptions } from "../../contracts/provider.ts";

export const EVENT_SOURCE = "browser";

export type CancelStrategy = "close-context" | "none";

export interface BrowserExtensionConfig {
    cancelStrategy?: CancelStrategy;
    defaultNavigationTimeout?: number;
    defaultTimeout?: number;
    emitNavigateEvent?: boolean;
    observeConsoleErrors?: boolean;
    observePageErrors?: boolean;
    openOptions?: OpenOptions;
    provider: BrowserProvider;
}

export interface ResolvedBrowserExtensionConfig {
    cancelStrategy: CancelStrategy;
    defaultNavigationTimeout: number | undefined;
    defaultTimeout: number | undefined;
    emitNavigateEvent: boolean;
    observeConsoleErrors: boolean;
    observePageErrors: boolean;
    openOptions: OpenOptions | undefined;
    provider: BrowserProvider;
}

export function resolveBrowserConfig(config: BrowserExtensionConfig): ResolvedBrowserExtensionConfig {
    return {
        cancelStrategy: config.cancelStrategy ?? "close-context",
        defaultNavigationTimeout: config.defaultNavigationTimeout,
        defaultTimeout: config.defaultTimeout,
        emitNavigateEvent: config.emitNavigateEvent ?? true,
        observeConsoleErrors: config.observeConsoleErrors ?? true,
        observePageErrors: config.observePageErrors ?? true,
        openOptions: config.openOptions,
        provider: config.provider,
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
    session: BrowserSession;
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
}

export type BrowserBus = PublishableBus<BrowserEventPayloads, EventMap>;
