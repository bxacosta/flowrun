/**
 * core/types.ts — Shared type utilities
 *
 * Layer: L0 (core). No internal dependencies.
 */

export type EmptyObject = Record<never, never>;
export type MaybePromise<T> = T | Promise<T>;

export interface IterationContext<TItem = unknown> {
    readonly index: number;
    readonly item: TItem;
}
export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type MergeObjects<TBase extends object, TNext extends object> = Simplify<Omit<TBase, keyof TNext> & TNext>;
