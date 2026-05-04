import type { MaybePromise } from "./utils.ts";

export type MiddlewareRun<TContext> = (context: TContext, next: () => Promise<void>) => MaybePromise<void>;

export interface Middleware<TContext> {
    readonly name: string;
    readonly run: MiddlewareRun<TContext>;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased middleware, typed at definition boundary
export type AnyMiddleware = Middleware<any>;

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
