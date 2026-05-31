/**
 * state/types.ts — State store contracts
 *
 * Layer: L2. The public {@link StateStore} surface (what `context.state` exposes)
 * and the runtime-only {@link InternalStateStore} that adds fork/merge plumbing.
 */

export type MergeStrategy = "append" | "exclusive" | "overwrite";

/**
 * State surface exposed to user code via `context.state`. Forking and
 * write-tracking are runtime concerns and live on {@link InternalStateStore}.
 */
export interface StateStore<TState extends object> {
    append<K extends keyof TState & string>(key: K, value: TState[K] extends (infer I)[] ? I : never): void;
    get<K extends keyof TState & string>(key: K): TState[K];
    has<K extends keyof TState & string>(key: K): boolean;
    patch(values: Partial<TState>): void;
    set<K extends keyof TState & string>(key: K, value: TState[K]): void;
    snapshot(): Readonly<TState>;
    update<K extends keyof TState & string>(key: K, updater: (current: TState[K]) => TState[K]): void;
}

/** Runtime-only store: adds fork/merge plumbing the engine uses for branches. */
export interface InternalStateStore<TState extends object> extends StateStore<TState> {
    fork(): InternalStateStore<TState>;
    getWrittenValues(): Map<string, unknown>;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased state store for runtime orchestration
export type AnyFlowStateStore = InternalStateStore<any>;
