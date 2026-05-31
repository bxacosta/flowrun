/**
 * definition/context-types.ts — Handler context types
 *
 * Layer: L3 (definition). The shapes user code receives in run/items/provide/
 * middleware callbacks. Pure types — construction lives in engine/context.ts.
 */

import type { EmptyObject } from "../core/types.ts";
import type { Logger } from "../events/logger.ts";
import type { EmitFn } from "../events/types.ts";
import type { EventsOf, IterationOf, ParamsOf, ProvidedOf, Shape, StateOf } from "../shape/shape.ts";
import type { StateStore } from "../state/types.ts";
import type { ContextRequest } from "./request.ts";

type IterationField<TIteration> = [TIteration] extends [never] ? EmptyObject : { readonly iteration: TIteration };

export type BaseContext<TShape extends Shape = Shape> = ProvidedOf<TShape> & {
    emit: EmitFn<EventsOf<TShape>>;
    flowName: string;
    log: Logger;
    params: Readonly<ParamsOf<TShape>>;
    request: ContextRequest;
    runId: string;
    signal: AbortSignal;
    state: StateStore<StateOf<TShape>>;
};

type TaskExtras<TIteration = never> = {
    attempt: number;
    nodeName: string;
    skip: (reason?: string) => never;
} & IterationField<TIteration>;

export type FlowContext<TShape extends Shape = Shape> = BaseContext<TShape>;
export type ContainerContext<TShape extends Shape = Shape> = BaseContext<TShape> & IterationField<IterationOf<TShape>>;
export type TaskContext<TShape extends Shape = Shape> = BaseContext<TShape> & TaskExtras<IterationOf<TShape>>;
