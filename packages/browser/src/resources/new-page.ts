import type { ResourceFactory } from "@flowrun/core";

import type { BrowserSession } from "../contracts/provider.ts";
import { createNavigate } from "../extension/browser/navigate.ts";
import {
    type BrowserEmit,
    browserEvents,
    type CancelStrategy,
    type NavigateFn,
    toBranchMeta,
} from "../extension/browser/types.ts";

export interface NewPageLocal {
    navigate: NavigateFn;
    page: BrowserSession["page"];
    session: BrowserSession;
}

export interface NewPageOptions {
    cancelStrategy?: CancelStrategy;
    defaultNavigationTimeout?: number;
    defaultTimeout?: number;
    emitNavigateEvent?: boolean;
}

interface NewPageContext {
    emit: BrowserEmit;
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

            const navigate = createNavigate(page, context.emit, { emitEvent: emitNavigate });
            const session: BrowserSession = { context: context.session.context, page };

            context.emit(browserEvents.pageOpened, toBranchMeta(meta));

            return { navigate, page, session };
        },

        dispose: async (context, meta) => {
            try {
                await context.page.close();
            } catch {
                /* idempotent */
            }
            context.emit(browserEvents.pageClosed, toBranchMeta(meta));
        },
    };
}
