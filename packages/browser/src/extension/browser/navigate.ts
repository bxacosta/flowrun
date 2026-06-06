import type { Page } from "playwright-core";

import { NavigationError } from "../../errors.ts";
import { type BrowserEmit, browserEvents, type NavigateFn, type NavigateOptions } from "./types.ts";

export interface CreateNavigateOptions {
    emitEvent: boolean;
}

export function createNavigate(page: Page, emit: BrowserEmit, options: CreateNavigateOptions): NavigateFn {
    return async (url: string, navigateOptions?: NavigateOptions): Promise<void> => {
        const start = Date.now();
        try {
            await page.goto(url, navigateOptions);
        } catch (error) {
            throw new NavigationError(url, Date.now() - start, error);
        }
        if (options.emitEvent) {
            emit(browserEvents.navigated, { durationMs: Date.now() - start, url });
        }
    };
}
