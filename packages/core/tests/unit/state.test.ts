import { describe, expect, test } from "bun:test";
import { MemoryStateStore, mergeBranchChanges } from "../../src/core/state.ts";
import { ParallelMergeError } from "../../src/index.ts";

describe("MemoryStateStore", () => {
    test("stores values and returns immutable snapshots", () => {
        const state = new MemoryStateStore<{ count?: number; label?: string }>({ count: 1 });

        state.set("label", "ready");

        expect(state.get("count")).toBe(1);
        expect(state.get("label")).toBe("ready");
        expect(state.snapshot()).toEqual({ count: 1, label: "ready" });
    });

    test("fork copies current state and tracks branch-local changes", () => {
        const state = new MemoryStateStore<{ count?: number; nested?: { ok: boolean } }>({ count: 1 });
        const fork = state.fork();

        fork.set("count", 2);
        fork.set("nested", { ok: true });

        expect(state.get("count")).toBe(1);
        expect(fork.snapshot()).toEqual({ count: 2, nested: { ok: true } });
        expect(fork.changes()).toEqual({ count: 2, nested: { ok: true } });
    });

    test("fork isolates nested objects via structuredClone", () => {
        const state = new MemoryStateStore<{ nested?: { items: string[] } }>({
            nested: { items: ["a"] },
        });
        const fork = state.fork();
        const nested = fork.get("nested");

        nested?.items.push("b");

        expect(state.snapshot()).toEqual({ nested: { items: ["a"] } });
        expect(fork.snapshot()).toEqual({ nested: { items: ["a", "b"] } });
    });
});

describe("mergeBranchChanges", () => {
    test("merges disjoint patches", () => {
        const merged = mergeBranchChanges<{ a?: number; b?: number }>([{ a: 1 }, { b: 2 }]);
        expect(merged.a).toBe(1);
        expect(merged.b).toBe(2);
    });

    test("allows identical values for the same key", () => {
        expect(mergeBranchChanges<{ a?: number }>([{ a: 1 }, { a: 1 }])).toEqual({ a: 1 });
    });

    test("throws when branches write conflicting values", () => {
        expect(() => mergeBranchChanges<{ a?: number }>([{ a: 1 }, { a: 2 }])).toThrow(ParallelMergeError);
    });

    test("supports overwrite merge strategy", () => {
        const merged = mergeBranchChanges<{ a?: number }>([{ a: 1 }, { a: 2 }], {
            strategy: "overwrite",
        });

        expect(merged.a).toBe(2);
    });

    test("supports append-arrays merge strategy", () => {
        const merged = mergeBranchChanges<{ items?: string[] }>([{ items: ["a"] }, { items: ["b", "c"] }], {
            strategy: "arrays",
        });

        expect(merged.items).toEqual(["a", "b", "c"]);
    });

    test("supports custom merge strategy", () => {
        const merged = mergeBranchChanges<{ score?: number }>([{ score: 2 }, { score: 5 }], {
            strategy: "custom",
            resolver: (_key, values) => Math.max(...(values as number[])),
        });

        expect(merged.score).toBe(5);
    });
});
