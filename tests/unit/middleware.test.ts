import {describe, expect, test} from "bun:test";
import {compose} from "../../src/middleware.ts";
import {createFlowContext, createStepContext} from "../../src/context.ts";
import {MemoryStateStore} from "../../src/state.ts";
import {NoopReporter} from "../../src";

interface MiddlewareState {
    ran?: boolean;
    order?: string[];
}

function makeStepContext() {
    const reporter = new NoopReporter();
    const base = createFlowContext({
        flowId: "flow",
        flowName: "Flow",
        runId: "run",
        params: {source: "test"},
        state: new MemoryStateStore<MiddlewareState>(),
        reporter,
        signal: new AbortController().signal,
    });

    return createStepContext(base, reporter, {id: "step", name: "Step"}, 1, base.signal);
}

describe("middleware compose", () => {
    test("runs middleware in onion order", async () => {
        const order: string[] = [];
        const pipeline = compose<{ source: string }, MiddlewareState>([
            async (_ctx, next) => {
                order.push("a:before");
                await next();
                order.push("a:after");
            },
            async (_ctx, next) => {
                order.push("b:before");
                await next();
                order.push("b:after");
            },
        ]);

        await pipeline(makeStepContext(), async () => {
            order.push("core");
        });

        expect(order).toEqual(["a:before", "b:before", "core", "b:after", "a:after"]);
    });

    test("allows short circuit without running core", async () => {
        let coreCalled = false;
        const pipeline = compose<{ source: string }, MiddlewareState>([
            async (ctx) => {
                ctx.state.set("ran", true);
            },
        ]);

        const ctx = makeStepContext();
        await pipeline(ctx, async () => {
            coreCalled = true;
        });

        expect(ctx.state.get("ran")).toBe(true);
        expect(coreCalled).toBe(false);
    });

    test("throws when next is called multiple times", async () => {
        const pipeline = compose<{ source: string }, MiddlewareState>([
            async (_ctx, next) => {
                await next();
                await next();
            },
        ]);

        expect(pipeline(makeStepContext(), async () => {
        })).rejects.toThrow("next() called multiple times");
    });
});
