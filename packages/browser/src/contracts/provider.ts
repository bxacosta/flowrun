import type { BrowserContext, BrowserContextOptions, Page } from "playwright-core";

export interface BrowserSession {
    readonly context: BrowserContext;
    readonly page: Page;
}

export interface OpenOptions {
    contextOptions?: BrowserContextOptions;
}

export interface BrowserProvider {
    close(session: BrowserSession): Promise<void>;
    dispose(): Promise<void>;
    open(options?: OpenOptions): Promise<BrowserSession>;
}
