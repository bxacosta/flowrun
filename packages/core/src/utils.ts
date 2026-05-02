export type EmptyObject = Record<never, never>;
export type MaybePromise<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type MergeObjects<TBase extends object, TNext extends object> = Simplify<Omit<TBase, keyof TNext> & TNext>;
