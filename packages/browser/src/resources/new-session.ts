import type { EveryMeta, ItemsContext, ParallelMeta } from "@flowrun/core";

import type { BrowserProvider, BrowserSession, OpenOptions } from "../contracts/provider.ts";
import { BrowserSessionError } from "../errors.ts";
import { type BrowserBus, createNavigate } from "../extension/navigate.ts";
import { EVENT_SOURCE, type NavigateFn } from "../extension/types.ts";

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

interface NewSessionResource {
    cleanup: (context: ItemsContext & NewSessionLocal, meta: EveryMeta<unknown> | ParallelMeta) => Promise<void>;
    provide: (context: ItemsContext, meta: EveryMeta<unknown> | ParallelMeta) => Promise<NewSessionLocal>;
}

export function newSession(options: NewSessionOptions = {}): NewSessionResource {
    const emitNavigate = options.emitNavigateEvent ?? true;
    const cancelStrategy = options.cancelStrategy ?? "close-context";

    return {
        provide: async (context, meta) => {
            const bus = context.bus as unknown as BrowserBus;
            const provider = (context as unknown as { provider: BrowserProvider }).provider;

            let session: BrowserSession;
            try {
                session = await provider.open({ contextOptions: options.contextOptions });
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

            const navigate = createNavigate(session.page, bus, { emitEvent: emitNavigate });

            await bus.publish("browser:session-opened", branchInfo(meta), { source: EVENT_SOURCE });

            return { session, page: session.page, navigate };
        },

        cleanup: async (context, meta) => {
            const bus = context.bus as unknown as BrowserBus;
            const provider = (context as unknown as { provider: BrowserProvider }).provider;
            try {
                await provider.close(context.session);
            } catch {
                /* idempotent */
            }
            await bus.publish("browser:session-closed", branchInfo(meta), { source: EVENT_SOURCE });
        },
    };
}

function branchInfo(meta: EveryMeta<unknown> | ParallelMeta): { branch?: string; iteration?: number } {
    if ("branchName" in meta) {
        return { branch: meta.branchName };
    }
    return { iteration: meta.index };
}
