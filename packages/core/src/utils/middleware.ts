import { FlowEngineError } from "../core/errors.ts";
import type { MiddlewareNext } from "../core/types.ts";

export const composeMiddleware = <TContext>(
    middlewares: readonly ((context: TContext, next: MiddlewareNext) => void | Promise<void>)[],
    terminal: (context: TContext) => void | Promise<void>
): ((context: TContext) => Promise<void>) => {
    return async (context) => {
        let index = -1;

        const dispatch = async (position: number): Promise<void> => {
            if (position <= index) {
                throw new FlowEngineError("Middleware called next() more than once");
            }

            index = position;

            const current = middlewares[position];

            if (current === undefined) {
                await terminal(context);
                return;
            }

            await current(context, async () => {
                await dispatch(position + 1);
            });
        };

        await dispatch(0);
    };
};
