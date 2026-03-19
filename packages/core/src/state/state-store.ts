import type { StateShape, StateStore } from "../core/types.ts";
import { cloneValue } from "../utils/clone.ts";

export class FlowStateStore<TState extends StateShape> implements StateStore<TState> {
    private readonly values: Partial<TState>;
    private readonly writtenKeys = new Set<keyof TState>();

    constructor(initialState: Partial<TState>) {
        this.values = cloneValue(initialState);
    }

    fork(): FlowStateStore<TState> {
        return new FlowStateStore<TState>(this.values);
    }

    get<TKey extends keyof TState>(key: TKey): TState[TKey] | undefined {
        const value = this.values[key];

        if (value === undefined) {
            return undefined;
        }

        return cloneValue(value) as TState[TKey];
    }

    getWrittenValues(): Map<keyof TState, TState[keyof TState]> {
        const result = new Map<keyof TState, TState[keyof TState]>();

        for (const key of this.writtenKeys) {
            const value = this.values[key];

            if (value !== undefined || key in this.values) {
                result.set(key, cloneValue(value) as TState[keyof TState]);
            }
        }

        return result;
    }

    has<TKey extends keyof TState>(key: TKey): boolean {
        return key in this.values;
    }

    patch(values: Partial<TState>): void {
        for (const key of Object.keys(values) as (keyof TState)[]) {
            const value = values[key];

            if (value !== undefined || key in values) {
                this.set(key, value as TState[keyof TState]);
            }
        }
    }

    set<TKey extends keyof TState>(key: TKey, value: TState[TKey]): void {
        this.values[key] = cloneValue(value);
        this.writtenKeys.add(key);
    }

    snapshot(): Readonly<TState> {
        return cloneValue(this.values) as Readonly<TState>;
    }
}
