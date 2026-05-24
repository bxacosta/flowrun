import type { ConsoleMessage, Page } from "playwright-core";

import { type BrowserBus, EVENT_SOURCE } from "./types.ts";

export interface ObserverOptions {
    consoleErrors: boolean;
    pageErrors: boolean;
}

export interface PageObservers {
    detach(): void;
}

export function attachPageObservers(page: Page, bus: BrowserBus, options: ObserverOptions): PageObservers {
    const detachers: Array<() => void> = [];

    if (options.pageErrors) {
        const handler = (error: Error): void => {
            bus.publish(
                "browser:page-error",
                { message: error.message, stack: error.stack },
                { source: EVENT_SOURCE }
            ).catch(() => undefined);
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
            bus.publish(
                "browser:console-error",
                {
                    text: message.text(),
                    location: location.url
                        ? {
                              url: location.url,
                              lineNumber: location.lineNumber,
                              columnNumber: location.columnNumber,
                          }
                        : undefined,
                },
                { source: EVENT_SOURCE }
            ).catch(() => undefined);
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
