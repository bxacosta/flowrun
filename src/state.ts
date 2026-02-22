import type {StateShape, StateStore} from "./types.ts";

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
): Partial<TState> {
    const merged: Partial<TState> = {};
    const seen = new Map<string, unknown[]>();

    for (const patch of patches) {
        for (const [key, value] of Object.entries(patch)) {
            const values = seen.get(key) ?? [];
            values.push(value);
            seen.set(key, values);
        }
    }

    for (const [key, values] of seen.entries()) {
        const distinctValues = values.filter(
            (value, index) => values.findIndex((candidate) => Object.is(candidate, value)) === index,
        );

        if (distinctValues.length <= 1) {
            (merged as Record<string, unknown>)[key] = cloneState(values[0]);
        }
    }

    return cloneState(merged);
}
