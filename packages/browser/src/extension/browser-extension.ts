import { define, type ExtensionDefinition, event, type Subscription } from "@flowrun/core";

import type { BrowserSession } from "../contracts/provider.ts";
import { BrowserSessionError } from "../errors.ts";
import { type BrowserBus, createNavigate } from "./navigate.ts";
import { attachPageObservers, type PageObservers } from "./page-observers.ts";
import { wrapStorage } from "./storage-wrap.ts";
import { createTracingLifecycle, type FlowOutcome, type TracingLifecycle } from "./tracing.ts";
import {
    type BrowserEventPayloads,
    type BrowserExtensionConfig,
    type BrowserProvidedContext,
    EVENT_SOURCE,
    resolveConfig,
} from "./types.ts";

export const BROWSER_EXTENSION_NAME = "browser";

export type BrowserExtensionDefinition = ExtensionDefinition<BrowserProvidedContext, object, BrowserEventPayloads>;

interface RunState {
    flowEndedSubscription: Subscription;
    observers: PageObservers;
    outcome: FlowOutcome;
    tracing: TracingLifecycle;
}

const runStates = new Map<string, RunState>();

export function createBrowserExtension(config: BrowserExtensionConfig): BrowserExtensionDefinition {
    const resolved = resolveConfig(config);

    return define.extension({
        name: BROWSER_EXTENSION_NAME,
        events: {
            "browser:opened": event.public<BrowserEventPayloads["browser:opened"]>(),
            "browser:closed": event.public<BrowserEventPayloads["browser:closed"]>(),
            "browser:navigated": event.public<BrowserEventPayloads["browser:navigated"]>(),
            "browser:page-error": event.public<BrowserEventPayloads["browser:page-error"]>(),
            "browser:console-error": event.public<BrowserEventPayloads["browser:console-error"]>(),
            "browser:page-opened": event.public<BrowserEventPayloads["browser:page-opened"]>(),
            "browser:page-closed": event.public<BrowserEventPayloads["browser:page-closed"]>(),
            "browser:session-opened": event.public<BrowserEventPayloads["browser:session-opened"]>(),
            "browser:session-closed": event.public<BrowserEventPayloads["browser:session-closed"]>(),
            "browser:tracing-saved": event.public<BrowserEventPayloads["browser:tracing-saved"]>(),
            "browser:storage-saved": event.public<BrowserEventPayloads["browser:storage-saved"]>(),
        },
        resource: {
            provide: async (context) => {
                const bus = context.bus as unknown as BrowserBus;
                let session: BrowserSession;
                try {
                    session = await resolved.provider.open(resolved.openOptions);
                } catch (error) {
                    if (error instanceof BrowserSessionError) {
                        throw error;
                    }
                    throw new BrowserSessionError("open", error);
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

                const state: RunState = {
                    outcome: "success",
                    observers,
                    tracing,
                    flowEndedSubscription: bus.subscribe(
                        "flow:ended" as keyof BrowserEventPayloads,
                        // biome-ignore lint/suspicious/noExplicitAny: subscribing to a system event whose payload is outside BrowserEventPayloads typing
                        (envelope: any) => {
                            if (envelope.payload?.runId !== context.runId) {
                                return;
                            }
                            const status = envelope.payload.status as FlowOutcome;
                            state.outcome = status;
                        }
                    ),
                };
                runStates.set(context.runId, state);

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
                return provided;
            },

            cleanup: async (context) => {
                const bus = context.bus as unknown as BrowserBus;
                const state = runStates.get(context.runId);
                runStates.delete(context.runId);

                if (state) {
                    await state.tracing.finish(state.outcome);
                    state.observers.detach();
                    state.flowEndedSubscription.unsubscribe();
                }

                let closeError: Error | undefined;
                try {
                    await resolved.provider.close(context.session);
                } catch (error) {
                    closeError = error instanceof BrowserSessionError ? error : new BrowserSessionError("close", error);
                }

                await bus.publish("browser:closed", {}, { source: EVENT_SOURCE });

                if (closeError) {
                    throw closeError;
                }
            },
        },
    });
}
