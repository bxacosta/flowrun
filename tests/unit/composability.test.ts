import { describe, expect, test } from "bun:test";
import { defineFlow, FlowEngineError, parallel, sequence, step } from "../../src";

describe("composability", () => {
    test("step creates a step node with sensible defaults", () => {
        const node = step("fetch-user", () => {
            //  Empty step
        });

        expect(node.kind).toBe("step");
        expect(node.id).toBe("fetch-user");
        expect(node.name).toBe("fetch-user");
        expect(node.use).toEqual([]);
    });

    test("sequence and parallel preserve child nodes", () => {
        const child = step("child", () => {
            //  Empty step
        });
        const seq = sequence("seq", [child], { name: "My Sequence" });
        const par = parallel("par", [child], { name: "My Parallel", concurrency: 2, mode: "all-settled" });

        expect(seq).toEqual({
            kind: "sequence",
            id: "seq",
            name: "My Sequence",
            nodes: [child],
        });

        expect(par.kind).toBe("parallel");
        expect(par.name).toBe("My Parallel");
        expect(par.concurrency).toBe(2);
        expect(par.mode).toBe("all-settled");
        expect(par.nodes).toEqual([child]);
    });

    test("parallel rejects invalid concurrency", () => {
        expect(() => parallel("bad", [], { concurrency: 0 })).toThrow(FlowEngineError);
    });

    test("defineFlow supports builder-based declaration", () => {
        const flow = defineFlow<{ userId: string }, { saved?: boolean }>({
            id: "sync-user",
            build: ({ step }) => [
                step("save", (ctx) => {
                    expect(ctx.params.userId).toBeString();
                    ctx.state.set("saved", true);
                }),
            ],
        });

        expect(flow.id).toBe("sync-user");
        expect(flow.name).toBe("sync-user");
        expect(flow.steps).toHaveLength(1);
        expect(flow.steps[0]?.kind).toBe("step");
    });

    test("defineFlow rejects flows without nodes", () => {
        expect(() => defineFlow({ id: "empty", steps: [] })).toThrow(FlowEngineError);
    });
});
