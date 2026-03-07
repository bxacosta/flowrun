import type { Middleware, StateShape, StepContext } from "./types.ts";

export function compose<TParams, TState extends StateShape>(
    middlewares: Middleware<TParams, TState>[]
): (context: StepContext<TParams, TState>, core: () => Promise<void>) => Promise<void> {
    return async (context, core) => {
        let index = -1;

        const dispatch = async (position: number): Promise<void> => {
            if (position <= index) {
                throw new Error("next() called multiple times");
            }

            index = position;

            if (position >= middlewares.length) {
                await core();
                return;
            }

            const middleware = middlewares[position];
            if (!middleware) {
                await core();
                return;
            }

            await middleware(context, () => dispatch(position + 1));
        };

        await dispatch(0);
    };
}
