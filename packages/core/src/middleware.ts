import type { AnyMiddleware, MaybePromise } from "./types.ts";

// ── Compose ───────────────────────────────────────────────────────────

export async function compose(
    middlewares: readonly AnyMiddleware[],
    context: Record<string, unknown>,
    handler: () => MaybePromise<void>
): Promise<void> {
    if (middlewares.length === 0) {
        await handler();
        return;
    }

    let index = -1;

    async function dispatch(i: number): Promise<void> {
        if (i <= index) {
            throw new Error("next() called multiple times");
        }
        index = i;
        const mw = middlewares[i];
        if (!mw) {
            await handler();
            return;
        }
        await mw(context, () => dispatch(i + 1));
    }

    await dispatch(0);
}
