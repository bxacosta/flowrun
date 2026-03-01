import {ParallelMergeError} from "./errors.ts";
import type {ParallelMergeConfig, StateShape, StateStore} from "./types.ts";

function cloneState<T>(value: T): T {
    return structuredClone(value);
}

export class MemoryStateStore<TState extends StateShape = StateShape>
    implements StateStore<TState> {
    private readonly values: TState;
    private readonly writes: Partial<TState> = {};

    constructor(initialState?: Partial<TState>) {
        this.values = cloneState((initialState ?? {}) as TState);
    }

    get<K extends keyof TState & string>(key: K): TState[K] | undefined {
        return this.values[key];
    }

    set<K extends keyof TState & string>(key: K, value: TState[K]): void {
        const cloned = cloneState(value);
        this.values[key] = cloned;
        this.writes[key] = cloned;
    }

    has<K extends keyof TState & string>(key: K): boolean {
        return key in this.values;
    }

    patch(values: Partial<TState>): void {
        for (const [key, value] of Object.entries(values) as Array<[
            keyof TState & string,
            TState[keyof TState & string],
        ]>) {
            const cloned = cloneState(value);
            this.values[key] = cloned;
            this.writes[key] = cloned;
        }
    }

    snapshot(): Readonly<TState> {
        return cloneState(this.values) as Readonly<TState>;
    }

    fork(): MemoryStateStore<TState> {
        return new MemoryStateStore<TState>(this.values);
    }

    changes(): Partial<TState> {
        return cloneState(this.writes);
    }
}

export function mergeBranchChanges<TState extends StateShape>(
    patches: Array<Partial<TState>>,
    config: ParallelMergeConfig<TState> = {strategy: "strict"},
): Partial<TState> {
    const merged: Partial<TState> = {};
    const seen = new Map<string, unknown[]>();
    const strategy = config.strategy ?? "strict";

    for (const patch of patches) {
        for (const [key, value] of Object.entries(patch)) {
            const values = seen.get(key) ?? [];
            values.push(value);
            seen.set(key, values);
        }
    }

    const collisions: string[] = [];

    for (const [key, values] of seen.entries()) {
        const distinctValues = values.filter(
            (value, index) => values.findIndex((candidate) => Object.is(candidate, value)) === index,
        );

        if (distinctValues.length <= 1) {
            (merged as Record<string, unknown>)[key] = cloneState(values[0]);
            continue;
        }

        if (strategy === "overwrite") {
            (merged as Record<string, unknown>)[key] = cloneState(values[values.length - 1]);
            continue;
        }

        if (strategy === "arrays" && values.every(Array.isArray)) {
            (merged as Record<string, unknown>)[key] = values.flatMap((value) => value as unknown[]);
            continue;
        }

        if (strategy === "custom" && config.resolver) {
            (merged as Record<string, unknown>)[key] = cloneState(
                config.resolver(
                    key as keyof TState & string,
                    values as Array<TState[keyof TState & string]>,
                ),
            );
            continue;
        }

        collisions.push(key);
    }

    if (collisions.length > 0) {
        throw new ParallelMergeError(collisions.sort());
    }

    return cloneState(merged);
}
