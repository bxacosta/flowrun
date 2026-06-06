import { type ContainerMeta, type EmitFn, event } from "@flowrun/core";

import type { BrowserProvider, BrowserSession, OpenOptions } from "../../contracts/provider.ts";

export type CancelStrategy = "close-context" | "none";

export interface BrowserExtensionConfig {
    cancelStrategy?: CancelStrategy;
    defaultNavigationTimeout?: number;
    defaultTimeout?: number;
    emitConsoleErrors?: boolean;
    emitNavigateEvent?: boolean;
    emitPageErrors?: boolean;
    openOptions?: OpenOptions;
    provider: BrowserProvider;
}

export interface ResolvedBrowserExtensionConfig {
    cancelStrategy: CancelStrategy;
    defaultNavigationTimeout: number | undefined;
    defaultTimeout: number | undefined;
    emitConsoleErrors: boolean;
    emitNavigateEvent: boolean;
    emitPageErrors: boolean;
    openOptions: OpenOptions | undefined;
    provider: BrowserProvider;
}

export function resolveBrowserConfig(config: BrowserExtensionConfig): ResolvedBrowserExtensionConfig {
    return {
        cancelStrategy: config.cancelStrategy ?? "close-context",
        defaultNavigationTimeout: config.defaultNavigationTimeout,
        defaultTimeout: config.defaultTimeout,
        emitConsoleErrors: config.emitConsoleErrors ?? true,
        emitNavigateEvent: config.emitNavigateEvent ?? true,
        emitPageErrors: config.emitPageErrors ?? true,
        openOptions: config.openOptions,
        provider: config.provider,
    };
}

export interface BranchMeta {
    branch?: string;
    iteration?: number;
}

// Projects a container's runtime meta onto the event payload: parallel branches
// carry their node `name`, each iterations carry their `index`.
export function toBranchMeta(meta: ContainerMeta): BranchMeta {
    return "item" in meta ? { iteration: meta.index } : { branch: meta.name };
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

// Event tokens: defined once, shared by the extension, resources, and subscribers.
export const browserEvents = {
    opened: event("browser:opened"),
    closed: event("browser:closed"),
    navigated: event<{ durationMs: number; url: string }>("browser:navigated"),
    pageError: event<{ message: string; stack?: string }>("browser:page-error"),
    consoleError: event<{ location?: ConsoleLocation; text: string }>("browser:console-error"),
    pageOpened: event<BranchMeta>("browser:page-opened"),
    pageClosed: event<BranchMeta>("browser:page-closed"),
    sessionOpened: event<BranchMeta>("browser:session-opened"),
    sessionClosed: event<BranchMeta>("browser:session-closed"),
} as const;

export type BrowserEvent = (typeof browserEvents)[keyof typeof browserEvents];

export type BrowserEmit = EmitFn<BrowserEvent>;
