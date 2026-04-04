import { InvalidMergeValueError, MergeConflictError } from "./errors.ts";
import type { AnyFlowStateStore, FlowStateStore, MergeStrategy } from "./types.ts";

// ── Internal Types ────────────────────────────────────────────────────

export interface ForkEntry {
    label: number | string;
    store: AnyFlowStateStore;
}

// ── State Store Factory ──────────────────────────────────────────────

export function createStateStore<TState extends Record<string, unknown>>(initial: TState): FlowStateStore<TState> {
    const rootData = new Map<string, unknown>();
    for (const [key, value] of Object.entries(initial)) {
        rootData.set(key, structuredClone(value));
    }
    return buildStore<TState>(rootData, null);
}

function buildStore<TState extends Record<string, unknown>>(
    data: Map<string, unknown>,
    parent: FlowStateStore<TState> | null
): FlowStateStore<TState> {
    const writtenKeys = new Set<string>();

    const store: FlowStateStore<TState> = {
        fork(_label) {
            return buildStore<TState>(new Map(), store);
        },

        get(key) {
            if (data.has(key)) {
                return structuredClone(data.get(key)) as TState[typeof key] | undefined;
            }
            if (parent) {
                return parent.get(key);
            }
            return undefined;
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
            if (parent) {
                return parent.has(key);
            }
            return false;
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

// ── Merge Helpers ────────────────────────────────────────────────────

function collectWrittenEntries(
    forks: readonly ForkEntry[]
): { label: number | string; values: Map<string, unknown> }[] {
    const entries: { label: number | string; values: Map<string, unknown> }[] = [];
    for (const fork of forks) {
        entries.push({ label: fork.label, values: fork.store.getWrittenValues() });
    }
    return entries;
}

function applyOverwrite(parent: AnyFlowStateStore, entries: readonly { values: Map<string, unknown> }[]): void {
    for (const { values } of entries) {
        for (const [key, value] of values) {
            parent.set(key, value);
        }
    }
}

function applyStrict(
    parent: AnyFlowStateStore,
    entries: readonly { label: number | string; values: Map<string, unknown> }[]
): void {
    const keyWriters = new Map<string, (number | string)[]>();
    const keyValues = new Map<string, unknown>();

    for (const { label, values } of entries) {
        for (const [key, value] of values) {
            const writers = keyWriters.get(key);
            if (writers) {
                writers.push(label);
            } else {
                keyWriters.set(key, [label]);
            }
            keyValues.set(key, value);
        }
    }

    for (const [key, writers] of keyWriters) {
        if (writers.length > 1) {
            throw new MergeConflictError(key, writers);
        }
    }

    for (const [key, value] of keyValues) {
        parent.set(key, value);
    }
}

function applyAppend(
    parent: AnyFlowStateStore,
    entries: readonly { label: number | string; values: Map<string, unknown> }[]
): void {
    const keyArrays = new Map<string, unknown[][]>();

    for (const { label, values } of entries) {
        for (const [key, value] of values) {
            if (!Array.isArray(value)) {
                throw new InvalidMergeValueError(key, label);
            }
            const existing = keyArrays.get(key);
            if (existing) {
                existing.push(value);
            } else {
                keyArrays.set(key, [value]);
            }
        }
    }

    for (const [key, arrays] of keyArrays) {
        parent.set(key, arrays.flat());
    }
}

// ── Public Merge Function ────────────────────────────────────────────

export function mergeForkedStores(
    parent: AnyFlowStateStore,
    forks: readonly ForkEntry[],
    strategy: MergeStrategy
): void {
    const entries = collectWrittenEntries(forks);

    switch (strategy) {
        case "append": {
            applyAppend(parent, entries);
            break;
        }
        case "overwrite": {
            applyOverwrite(parent, entries);
            break;
        }
        case "strict": {
            applyStrict(parent, entries);
            break;
        }
        default: {
            throw new Error(`Unknown merge strategy: ${strategy}`);
        }
    }
}
