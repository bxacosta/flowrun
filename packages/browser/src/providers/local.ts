import type { Browser, LaunchOptions } from "playwright-core";
import { chromium } from "playwright-core";

import type { BrowserProvider, BrowserSession, OpenOptions } from "../contracts/provider.ts";
import { BrowserProviderDisposedError, BrowserSessionError } from "../errors.ts";

export interface LocalLaunchOptions extends LaunchOptions {
    channel?: "chrome" | "chromium" | "msedge";
    executablePath?: string;
    headless?: boolean;
}

export class LocalBrowserProvider implements BrowserProvider {
    private readonly launchOptions: LocalLaunchOptions;
    private browserPromise: Promise<Browser> | null = null;
    private disposed = false;

    constructor(launchOptions: LocalLaunchOptions = {}) {
        this.launchOptions = { channel: "chrome", headless: true, ...launchOptions };
    }

    async open(options?: OpenOptions): Promise<BrowserSession> {
        if (this.disposed) {
            throw new BrowserProviderDisposedError();
        }

        try {
            const browser = await this.getBrowser();
            const context = await browser.newContext(options?.contextOptions);
            const page = await context.newPage();
            return { context, page };
        } catch (error) {
            if (error instanceof BrowserProviderDisposedError) {
                throw error;
            }
            throw new BrowserSessionError("open", error);
        }
    }

    async close(session: BrowserSession): Promise<void> {
        try {
            await session.context.close();
        } catch {
            // idempotent: ignore failures when the context is already gone
        }
    }

    async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const pending = this.browserPromise;
        this.browserPromise = null;
        if (!pending) {
            return;
        }
        try {
            const browser = await pending;
            await browser.close();
        } catch {
            // best-effort: swallow shutdown errors
        }
    }

    private getBrowser(): Promise<Browser> {
        if (!this.browserPromise) {
            this.browserPromise = chromium.launch(this.launchOptions).catch((error) => {
                this.browserPromise = null;
                throw error;
            });
        }
        return this.browserPromise;
    }
}
