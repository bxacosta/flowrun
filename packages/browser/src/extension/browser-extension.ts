import { type ExtensionDefinition, eventPublic, extension, FlowCancellationSignal } from "@flowrun/core";

import type { BrowserSession } from "../contracts/provider.ts";
import { BrowserSessionError } from "../errors.ts";
import { type BrowserBus, createNavigate } from "./navigate.ts";
import { attachPageObservers } from "./page-observers.ts";
import { wrapStorage } from "./storage-wrap.ts";
import { createTracingLifecycle, type FlowOutcome as TracingOutcome } from "./tracing.ts";
import {
    type BrowserEventPayloads,
    type BrowserExtensionConfig,
    type BrowserProvidedContext,
    EVENT_SOURCE,
    resolveConfig,
} from "./types.ts";

export const BROWSER_EXTENSION_NAME = "browser";

export type BrowserExtensionDefinition = ExtensionDefinition<
    object,
    BrowserProvidedContext,
    object,
    BrowserEventPayloads
>;

export function createBrowserExtension(config: BrowserExtensionConfig): BrowserExtensionDefinition {
    const resolved = resolveConfig(config);

    return extension({
        name: BROWSER_EXTENSION_NAME,
        events: {
            "browser:opened": eventPublic<BrowserEventPayloads["browser:opened"]>(),
            "browser:closed": eventPublic<BrowserEventPayloads["browser:closed"]>(),
            "browser:navigated": eventPublic<BrowserEventPayloads["browser:navigated"]>(),
            "browser:page-error": eventPublic<BrowserEventPayloads["browser:page-error"]>(),
            "browser:console-error": eventPublic<BrowserEventPayloads["browser:console-error"]>(),
            "browser:page-opened": eventPublic<BrowserEventPayloads["browser:page-opened"]>(),
            "browser:page-closed": eventPublic<BrowserEventPayloads["browser:page-closed"]>(),
            "browser:session-opened": eventPublic<BrowserEventPayloads["browser:session-opened"]>(),
            "browser:session-closed": eventPublic<BrowserEventPayloads["browser:session-closed"]>(),
            "browser:tracing-saved": eventPublic<BrowserEventPayloads["browser:tracing-saved"]>(),
            "browser:storage-saved": eventPublic<BrowserEventPayloads["browser:storage-saved"]>(),
        },
        provide: async (context) => {
            const bus: BrowserBus = context.bus;

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

            const observers = attachPageObservers(session.page, bus, {
                pageErrors: resolved.observePageErrors,
                consoleErrors: resolved.observeConsoleErrors,
            });

            const tracing = createTracingLifecycle(session.context, bus, resolved.storage, resolved.trace, {
                runId: context.runId,
                flowName: context.flowName,
            });
            await tracing.start();

            const navigate = createNavigate(session.page, bus, { emitEvent: resolved.emitNavigateEvent });
            const wrappedStorage = wrapStorage(resolved.storage, bus, { emitEvent: resolved.emitStorageEvent });

            await bus.publish("browser:opened", {}, { source: EVENT_SOURCE });

            const provided: BrowserProvidedContext = {
                session,
                page: session.page,
                provider: resolved.provider,
                selectors: resolved.selectors,
                storage: wrappedStorage,
                navigate,
            };

            return {
                provided,
                cleanup: async (outcome) => {
                    await tracing.finish(outcome.status as TracingOutcome);
                    observers.detach();

                    let closeError: Error | undefined;
                    try {
                        await resolved.provider.close(session);
                    } catch (error) {
                        closeError =
                            error instanceof BrowserSessionError ? error : new BrowserSessionError("close", error);
                    }

                    await bus.publish("browser:closed", {}, { source: EVENT_SOURCE });

                    if (closeError) {
                        throw closeError;
                    }
                },
            };
        },
    });
}
