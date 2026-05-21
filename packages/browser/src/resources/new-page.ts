import type { ContainerMeta, ResourceFactory } from "@flowrun/core";

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

interface NewPageContext {
    bus: BrowserBus;
    session: BrowserSession;
    signal: AbortSignal;
}

export function newPage(options: NewPageOptions = {}): ResourceFactory<NewPageContext, NewPageLocal> {
    const emitNavigate = options.emitNavigateEvent ?? true;
    const cancelStrategy = options.cancelStrategy ?? "close-context";

    return {
        provide: async (context, meta) => {
            const page = await context.session.context.newPage();

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

            const navigate = createNavigate(page, context.bus, { emitEvent: emitNavigate });
            const session: BrowserSession = { context: context.session.context, page };

            await context.bus.publish("browser:page-opened", branchInfo(meta), { source: EVENT_SOURCE });

            return { session, page, navigate };
        },

        cleanup: async (context, meta) => {
            try {
                await context.page.close();
            } catch {
                /* idempotent */
            }
            await context.bus.publish("browser:page-closed", branchInfo(meta), { source: EVENT_SOURCE });
        },
    };
}

function branchInfo(meta: ContainerMeta): { branch?: string; iteration?: number } {
    if ("branchName" in meta) {
        return { branch: meta.branchName };
    }
    return { iteration: meta.index };
}
