import type { StateStore } from "../core/types.ts";
import { cloneValue } from "../utils/clone.ts";
import type { AnyRecord } from "../utils/type-helpers.ts";

export class FlowStateStore<TState extends AnyRecord<TState>> implements StateStore<TState> {
    private readonly values: Partial<TState>;
    private readonly writtenKeys = new Set<keyof TState>();

    constructor(initialState: Partial<TState>) {
        this.values = cloneValue(initialState);
    }

    fork(): FlowStateStore<TState> {
        return new FlowStateStore<TState>(this.values);
    }

    get<TStateKey extends keyof TState>(key: TStateKey): TState[TStateKey] | undefined {
        const value = this.values[key];

        if (value === undefined) {
            return undefined;
        }

        return cloneValue(value) as TState[TStateKey];
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

    has<TStateKey extends keyof TState>(key: TStateKey): boolean {
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

    set<TStateKey extends keyof TState>(key: TStateKey, value: TState[TStateKey]): void {
        this.values[key] = cloneValue(value);
        this.writtenKeys.add(key);
    }

    snapshot(): Readonly<TState> {
        return cloneValue(this.values) as Readonly<TState>;
    }
}
