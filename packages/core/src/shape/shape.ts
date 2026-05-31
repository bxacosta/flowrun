/**
 * shape/shape.ts — Shape type system
 *
 * Layer: L1. Pure types describing a flow's contract (params, state, events,
 * provided context, iteration) and the combinators that extend it.
 */

import type { EmptyObject, MergeObjects } from "../core/types.ts";
import type { EventMap } from "../events/types.ts";

export interface IterationContext<TItem> {
    index: number;
    item: TItem;
}

export interface Shape {
    events?: EventMap;
    iteration?: unknown;
    params?: object;
    provided?: object;
    state?: object;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased shape for heterogeneous registries
export type AnyShape = Shape & Record<string, any>;

export type ParamsOf<TShape extends Shape> = TShape extends { params: infer P extends object } ? P : EmptyObject;

export type StateOf<TShape extends Shape> = TShape extends { state: infer T extends object } ? T : EmptyObject;

export type ProvidedOf<TShape extends Shape> = TShape extends { provided: infer P extends object } ? P : EmptyObject;

export type IterationOf<TShape extends Shape> = TShape extends { iteration: infer I } ? I : never;

export type EventsOf<TShape extends Shape> = TShape extends { events: infer E extends EventMap } ? E : EmptyObject;

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type WithParams<TShape extends Shape, TParams extends object> =
    Equals<TParams, ParamsOf<TShape>> extends true ? TShape : Omit<TShape, "params"> & { params: TParams };

export type WithState<TShape extends Shape, TState extends object> =
    Equals<TState, StateOf<TShape>> extends true ? TShape : Omit<TShape, "state"> & { state: TState };

export type WithEvents<TShape extends Shape, TEvents extends EventMap> = Omit<TShape, "events"> & {
    events: MergeObjects<EventsOf<TShape>, TEvents>;
};

export type WithProvided<TShape extends Shape, TLocal extends object> = Omit<TShape, "provided"> & {
    provided: MergeObjects<ProvidedOf<TShape>, TLocal>;
};

export type WithIteration<TShape extends Shape, TItem> = Omit<TShape, "iteration"> & {
    iteration: IterationContext<TItem>;
};
