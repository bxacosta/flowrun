/**
 * definition/middleware.ts — Middleware definition & factory
 *
 * Layer: L3 (definition). The Koa/Hono-style `(context, next)` contract and the
 * `middleware()` factory. The runner (`compose`) lives in engine/compose.ts.
 */

import type { MaybePromise } from "../core/types.ts";
import { assertValidName } from "../core/validation.ts";
import type { Shape } from "../shape/shape.ts";
import type { FlowContext, TaskContext } from "./context-types.ts";

export type MiddlewareRun<TContext> = (context: TContext, next: () => Promise<void>) => MaybePromise<void>;

export interface Middleware<TContext> {
    readonly name: string;
    readonly run: MiddlewareRun<TContext>;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased middleware, typed at definition boundary
export type AnyMiddleware = Middleware<any>;

export interface MiddlewareConfig<TContext> {
    name: string;
    run: MiddlewareRun<TContext>;
}

export type FlowMiddleware<TShape extends Shape> = Middleware<FlowContext<TShape>>;
export type TaskMiddleware<TShape extends Shape> = Middleware<TaskContext<TShape>>;

export function middleware<TContext>(config: MiddlewareConfig<TContext>): Middleware<TContext> {
    assertValidName("middleware", config.name);
    return { name: config.name, run: config.run };
}
