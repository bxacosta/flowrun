import type { ResourceFactory } from "@flowrun/core";

import type { BrowserProvider, BrowserSession, OpenOptions } from "../contracts/provider.ts";
import { BrowserSessionError } from "../errors.ts";
import { createNavigate } from "../extension/browser/navigate.ts";
import {
    type BrowserEmit,
    browserEvents,
    type CancelStrategy,
    type NavigateFn,
    toBranchMeta,
} from "../extension/browser/types.ts";

export interface NewSessionLocal {
    navigate: NavigateFn;
    page: BrowserSession["page"];
    session: BrowserSession;
}

export interface NewSessionOptions extends OpenOptions {
    cancelStrategy?: CancelStrategy;
    defaultNavigationTimeout?: number;
    defaultTimeout?: number;
    emitNavigateEvent?: boolean;
}

interface NewSessionContext {
    emit: BrowserEmit;
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

            const navigate = createNavigate(session.page, context.emit, { emitEvent: emitNavigate });

            context.emit(browserEvents.sessionOpened, toBranchMeta(meta));

            return { navigate, page: session.page, session };
        },

        dispose: async (context, meta) => {
            try {
                await context.provider.close(context.session);
            } catch {
                /* idempotent */
            }
            context.emit(browserEvents.sessionClosed, toBranchMeta(meta));
        },
    };
}
