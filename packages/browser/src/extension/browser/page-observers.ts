import type { ConsoleMessage, Page } from "playwright-core";

import { type BrowserEmit, browserEvents } from "./types.ts";

export interface ObserverOptions {
    consoleErrors: boolean;
    pageErrors: boolean;
}

export interface PageObservers {
    detach(): void;
}

export function attachPageObservers(page: Page, emit: BrowserEmit, options: ObserverOptions): PageObservers {
    const detachers: Array<() => void> = [];

    if (options.pageErrors) {
        const handler = (error: Error): void => {
            emit(browserEvents.pageError, { message: error.message, stack: error.stack });
        };
        page.on("pageerror", handler);
        detachers.push(() => page.off("pageerror", handler));
    }

    if (options.consoleErrors) {
        const handler = (message: ConsoleMessage): void => {
            if (message.type() !== "error") {
                return;
            }
            const location = message.location();
            emit(browserEvents.consoleError, {
                location: location.url
                    ? {
                          columnNumber: location.columnNumber,
                          lineNumber: location.lineNumber,
                          url: location.url,
                      }
                    : undefined,
                text: message.text(),
            });
        };
        page.on("console", handler);
        detachers.push(() => page.off("console", handler));
    }

    return {
        detach: () => {
            for (const detacher of detachers) {
                detacher();
            }
        },
    };
}
