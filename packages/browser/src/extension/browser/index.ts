import { type ExtensionDefinition, extension, FlowCancellationSignal } from "@flowrun/core";

import type { BrowserSession } from "../../contracts/provider.ts";
import { BrowserSessionError } from "../../errors.ts";
import { createNavigate } from "./navigate.ts";
import { attachPageObservers } from "./page-observers.ts";
import {
    type BrowserExtensionConfig,
    type BrowserProvidedContext,
    browserEvents,
    resolveBrowserConfig,
} from "./types.ts";

export const BROWSER_EXTENSION_NAME = "browser";

export type BrowserExtensionDefinition = ExtensionDefinition<object, BrowserProvidedContext>;

export function createBrowserExtension(config: BrowserExtensionConfig): BrowserExtensionDefinition {
    const resolved = resolveBrowserConfig(config);

    return extension({
        name: BROWSER_EXTENSION_NAME,
        events: [
            browserEvents.opened,
            browserEvents.closed,
            browserEvents.navigated,
            browserEvents.pageError,
            browserEvents.consoleError,
            browserEvents.pageOpened,
            browserEvents.pageClosed,
            browserEvents.sessionOpened,
            browserEvents.sessionClosed,
        ],
        setup: async (context) => {
            let session: BrowserSession;
            try {
                session = await resolved.provider.open(resolved.openOptions);
            } catch (error) {
                if (error instanceof BrowserSessionError) {
                    throw error;
                }
                throw new BrowserSessionError("open", error);
            }

            if (resolved.cancelStrategy === "close-context" && !context.signal.aborted) {
                context.signal.addEventListener(
                    "abort",
                    () => {
                        if (!(context.signal.reason instanceof FlowCancellationSignal)) {
                            return;
                        }
                        session.context.close().catch(() => undefined);
                    },
                    { once: true }
                );
            }

            if (resolved.defaultTimeout !== undefined) {
                session.page.setDefaultTimeout(resolved.defaultTimeout);
            }
            if (resolved.defaultNavigationTimeout !== undefined) {
                session.page.setDefaultNavigationTimeout(resolved.defaultNavigationTimeout);
            }

            const observers = attachPageObservers(session.page, context.emit, {
                consoleErrors: resolved.emitConsoleErrors,
                pageErrors: resolved.emitPageErrors,
            });

            const navigate = createNavigate(session.page, context.emit, { emitEvent: resolved.emitNavigateEvent });

            context.emit(browserEvents.opened);

            const provided: BrowserProvidedContext = {
                navigate,
                page: session.page,
                provider: resolved.provider,
                session,
            };

            return {
                provided,
                dispose: async () => {
                    observers.detach();

                    let closeError: Error | undefined;
                    try {
                        await resolved.provider.close(session);
                    } catch (error) {
                        closeError =
                            error instanceof BrowserSessionError ? error : new BrowserSessionError("close", error);
                    }

                    context.emit(browserEvents.closed);

                    if (closeError) {
                        throw closeError;
                    }
                },
            };
        },
    });
}
