/**
 * shape/shape.ts — Shape type system
 *
 * Layer: L1. Pure types describing a flow's contract (params, state, events,
 * provided context, iteration) and the combinators that extend it.
 */

import type { EmptyObject, IterationContext, MergeObjects } from "../core/types.ts";
import type { AnyEventToken } from "../events/types.ts";

export interface Shape {
    events?: AnyEventToken;
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

export type EventsOf<TShape extends Shape> = TShape extends { events: infer E extends AnyEventToken } ? E : never;

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type WithParams<TShape extends Shape, TParams extends object> =
    Equals<TParams, ParamsOf<TShape>> extends true ? TShape : Omit<TShape, "params"> & { params: TParams };

export type WithState<TShape extends Shape, TState extends object> =
    Equals<TState, StateOf<TShape>> extends true ? TShape : Omit<TShape, "state"> & { state: TState };

export type WithEvents<TShape extends Shape, TToken extends AnyEventToken> = Omit<TShape, "events"> & {
    events: EventsOf<TShape> | TToken;
};

export type WithProvided<TShape extends Shape, TLocal extends object> = Omit<TShape, "provided"> & {
    provided: MergeObjects<ProvidedOf<TShape>, TLocal>;
};

export type WithIteration<TShape extends Shape, TItem> = Omit<TShape, "iteration"> & {
    iteration: IterationContext<TItem>;
};

// ── Composition ─────────────────────────────────────────────────────

type UnionEvents<TFirst, TSecond> = [TFirst] extends [never]
    ? TSecond
    : [TSecond] extends [never]
      ? TFirst
      : TFirst | TSecond;

interface ComposePair<TBase extends Shape, TNext extends Shape> {
    events: UnionEvents<EventsOf<TBase>, EventsOf<TNext>>;
    iteration: [IterationOf<TNext>] extends [never] ? IterationOf<TBase> : IterationOf<TNext>;
    params: MergeObjects<ParamsOf<TBase>, ParamsOf<TNext>>;
    provided: MergeObjects<ProvidedOf<TBase>, ProvidedOf<TNext>>;
    state: MergeObjects<StateOf<TBase>, StateOf<TNext>>;
}

type ComposeFold<TShapes extends readonly Shape[], TAccumulated extends Shape> = TShapes extends readonly [
    infer THead extends Shape,
    ...infer TRest extends Shape[],
]
    ? ComposeFold<TRest, ComposePair<TAccumulated, THead>>
    : TAccumulated;

// Folds shapes into one: provided/params/state merge (last wins), events union.
export type Compose<TShapes extends readonly Shape[]> = ComposeFold<TShapes, EmptyObject>;
