/**
 * state/store.ts — State store implementation & fork merging
 *
 * Layer: L2. Copy-on-read/write store with structural cloning, plus the
 * fork-merge strategies (append/overwrite/exclusive).
 */

import { assertPlainObject } from "../core/validation.ts";
import { InvalidMergeValueError, MergeConflictError } from "./errors.ts";
import type { AnyFlowStateStore, InternalStateStore, MergeStrategy } from "./types.ts";

export interface ForkEntry {
    label: number | string;
    store: AnyFlowStateStore;
}

// ── Store ───────────────────────────────────────────────────────────

export function createStateStore<TState extends object>(initial: TState): InternalStateStore<TState> {
    assertPlainObject(initial, "Flow state must be a plain object");
    const root = new Map<string, unknown>();
    for (const [key, value] of Object.entries(initial)) {
        root.set(key, structuredClone(value));
    }
    return createStore(root, null);
}

function createStore<TState extends object>(
    data: Map<string, unknown>,
    parent: InternalStateStore<TState> | null
): InternalStateStore<TState> {
    const writtenKeys = new Set<string>();

    const store: InternalStateStore<TState> = {
        append(key, value) {
            const current = store.get(key);
            const next = Array.isArray(current) ? [...current, value] : [value];
            store.set(key, next as TState[typeof key]);
        },

        fork() {
            return createStore<TState>(new Map(), store);
        },

        get(key) {
            if (data.has(key)) {
                return structuredClone(data.get(key)) as TState[typeof key];
            }
            if (parent) {
                return parent.get(key);
            }
            return undefined as TState[typeof key];
        },

        getWrittenValues() {
            const result = new Map<string, unknown>();
            for (const key of writtenKeys) {
                result.set(key, structuredClone(data.get(key)));
            }
            return result;
        },

        has(key) {
            if (data.has(key)) {
                return true;
            }
            return parent ? parent.has(key) : false;
        },

        patch(values) {
            for (const [key, value] of Object.entries(values)) {
                data.set(key, structuredClone(value));
                writtenKeys.add(key);
            }
        },

        set(key, value) {
            data.set(key, structuredClone(value));
            writtenKeys.add(key);
        },

        update(key, updater) {
            store.set(key, updater(store.get(key)));
        },

        snapshot() {
            const result: Record<string, unknown> = parent ? { ...parent.snapshot() } : {};
            for (const [key, value] of data) {
                result[key] = structuredClone(value);
            }
            return Object.freeze(result) as Readonly<TState>;
        },
    };

    return store;
}

// ── Fork merging ────────────────────────────────────────────────────

function collectWrittenEntries(
    forks: readonly ForkEntry[]
): { label: number | string; values: Map<string, unknown> }[] {
    return forks.map((fork) => ({ label: fork.label, values: fork.store.getWrittenValues() }));
}

function applyAppend(
    parent: AnyFlowStateStore,
    entries: readonly { label: number | string; values: Map<string, unknown> }[]
): void {
    const arraysByKey = new Map<string, unknown[][]>();

    for (const { label, values } of entries) {
        for (const [key, value] of values) {
            if (!Array.isArray(value)) {
                throw new InvalidMergeValueError(key, label);
            }
            const arrays = arraysByKey.get(key);
            if (arrays) {
                arrays.push(value);
            } else {
                arraysByKey.set(key, [value]);
            }
        }
    }

    for (const [key, arrays] of arraysByKey) {
        parent.set(key, arrays.flat());
    }
}

function applyOverwrite(parent: AnyFlowStateStore, entries: readonly { values: Map<string, unknown> }[]): void {
    for (const { values } of entries) {
        for (const [key, value] of values) {
            parent.set(key, value);
        }
    }
}

function applyExclusive(
    parent: AnyFlowStateStore,
    entries: readonly { label: number | string; values: Map<string, unknown> }[]
): void {
    const writersByKey = new Map<string, (number | string)[]>();
    const valuesByKey = new Map<string, unknown>();

    for (const { label, values } of entries) {
        for (const [key, value] of values) {
            const writers = writersByKey.get(key);
            if (writers) {
                writers.push(label);
            } else {
                writersByKey.set(key, [label]);
            }
            valuesByKey.set(key, value);
        }
    }

    for (const [key, writers] of writersByKey) {
        if (writers.length > 1) {
            throw new MergeConflictError(key, writers);
        }
    }

    for (const [key, value] of valuesByKey) {
        parent.set(key, value);
    }
}

export function mergeForkedStores(
    parent: AnyFlowStateStore,
    forks: readonly ForkEntry[],
    strategy: MergeStrategy
): void {
    const entries = collectWrittenEntries(forks);

    switch (strategy) {
        case "append":
            applyAppend(parent, entries);
            return;
        case "overwrite":
            applyOverwrite(parent, entries);
            return;
        case "exclusive":
            applyExclusive(parent, entries);
            return;
        default:
            throw new Error(`Unknown merge strategy: ${strategy}`);
    }
}
