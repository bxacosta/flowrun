import type { ContainerMeta, ResourceFactory } from "@flowrun/core";

import type { BrowserProvider, BrowserSession, OpenOptions } from "../contracts/provider.ts";
import { BrowserSessionError } from "../errors.ts";
import { createNavigate } from "../extension/browser/navigate.ts";
import { type BrowserBus, EVENT_SOURCE, type NavigateFn } from "../extension/browser/types.ts";

export interface NewSessionLocal {
    navigate: NavigateFn;
    page: BrowserSession["page"];
    session: BrowserSession;
}

export interface NewSessionOptions extends OpenOptions {
    cancelStrategy?: "close-context" | "none";
    defaultNavigationTimeout?: number;
    defaultTimeout?: number;
    emitNavigateEvent?: boolean;
}

interface NewSessionContext {
    bus: BrowserBus;
    provider: BrowserProvider;
    signal: AbortSignal;
}

export function newSession(options: NewSessionOptions = {}): ResourceFactory<NewSessionContext, NewSessionLocal> {
    const emitNavigate = options.emitNavigateEvent ?? true;
    const cancelStrategy = options.cancelStrategy ?? "close-context";

    return {
        provide: async (context, meta) => {
            let session: BrowserSession;
            try {
                session = await context.provider.open({ contextOptions: options.contextOptions });
            } catch (error) {
                if (error instanceof BrowserSessionError) {
                    throw error;
                }
                throw new BrowserSessionError("open", error);
            }

            if (options.defaultTimeout !== undefined) {
                session.page.setDefaultTimeout(options.defaultTimeout);
            }
            if (options.defaultNavigationTimeout !== undefined) {
                session.page.setDefaultNavigationTimeout(options.defaultNavigationTimeout);
            }

            if (cancelStrategy === "close-context" && !context.signal.aborted) {
                context.signal.addEventListener(
                    "abort",
                    () => {
                        session.context.close().catch(() => {
                            /* idempotent */
                        });
                    },
                    { once: true }
                );
            }

            const navigate = createNavigate(session.page, context.bus, { emitEvent: emitNavigate });

            await context.bus.publish("browser:session-opened", branchInfo(meta), { source: EVENT_SOURCE });

            return { session, page: session.page, navigate };
        },

        cleanup: async (context, meta) => {
            try {
                await context.provider.close(context.session);
            } catch {
                /* idempotent */
            }
            await context.bus.publish("browser:session-closed", branchInfo(meta), { source: EVENT_SOURCE });
        },
    };
}

function branchInfo(meta: ContainerMeta): { branch?: string; iteration?: number } {
    if ("branchName" in meta) {
        return { branch: meta.branchName };
    }
    return { iteration: meta.index };
}
