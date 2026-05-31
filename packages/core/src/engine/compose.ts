/**
 * engine/compose.ts — Middleware runner
 *
 * Layer: L4 (engine). Runs a middleware chain around a handler, Koa/Hono-style,
 * guarding against `next()` being called more than once.
 */

import type { MaybePromise } from "../core/types.ts";
import type { AnyMiddleware } from "../definition/middleware.ts";

export async function compose(
    middlewares: readonly AnyMiddleware[],
    context: Record<string, unknown>,
    handler: () => MaybePromise<void>
): Promise<void> {
    let index = -1;

    async function dispatch(nextIndex: number): Promise<void> {
        if (nextIndex <= index) {
            throw new Error("next() called multiple times");
        }
        index = nextIndex;

        const middleware = middlewares[nextIndex];
        if (!middleware) {
            await handler();
            return;
        }

        await middleware.run(context, () => dispatch(nextIndex + 1));
    }

    await dispatch(0);
}
