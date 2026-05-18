import type { EveryMeta, ItemsContext, ParallelMeta } from "@flowrun/core";

import type { BrowserSession } from "../contracts/provider.ts";
import { type BrowserBus, createNavigate } from "../extension/navigate.ts";
import { EVENT_SOURCE, type NavigateFn } from "../extension/types.ts";

export interface NewPageLocal {
    navigate: NavigateFn;
    page: BrowserSession["page"];
    session: BrowserSession;
}

export interface NewPageOptions {
    cancelStrategy?: "close-context" | "none";
    defaultNavigationTimeout?: number;
    defaultTimeout?: number;
    emitNavigateEvent?: boolean;
}

interface NewPageResource {
    cleanup: (context: ItemsContext & NewPageLocal, meta: EveryMeta<unknown> | ParallelMeta) => Promise<void>;
    provide: (context: ItemsContext, meta: EveryMeta<unknown> | ParallelMeta) => Promise<NewPageLocal>;
}

export function newPage(options: NewPageOptions = {}): NewPageResource {
    const emitNavigate = options.emitNavigateEvent ?? true;
    const cancelStrategy = options.cancelStrategy ?? "close-context";

    return {
        provide: async (context, meta) => {
            const bus = context.bus as unknown as BrowserBus;
            const parent = context as unknown as { session: BrowserSession };
            const page = await parent.session.context.newPage();

            if (options.defaultTimeout !== undefined) {
                page.setDefaultTimeout(options.defaultTimeout);
            }
            if (options.defaultNavigationTimeout !== undefined) {
                page.setDefaultNavigationTimeout(options.defaultNavigationTimeout);
            }

            if (cancelStrategy === "close-context" && !context.signal.aborted) {
                context.signal.addEventListener(
                    "abort",
                    () => {
                        page.close().catch(() => {
                            /* idempotent */
                        });
                    },
                    { once: true }
                );
            }

            const navigate = createNavigate(page, bus, { emitEvent: emitNavigate });
            const session: BrowserSession = { context: parent.session.context, page };

            await bus.publish("browser:page-opened", branchInfo(meta), { source: EVENT_SOURCE });

            return { session, page, navigate };
        },

        cleanup: async (context, meta) => {
            const bus = context.bus as unknown as BrowserBus;
            try {
                await context.page.close();
            } catch {
                /* idempotent */
            }
            await bus.publish("browser:page-closed", branchInfo(meta), { source: EVENT_SOURCE });
        },
    };
}

function branchInfo(meta: EveryMeta<unknown> | ParallelMeta): { branch?: string; iteration?: number } {
    if ("branchName" in meta) {
        return { branch: meta.branchName };
    }
    return { iteration: meta.index };
}
