import { describe, expect, test } from "bun:test";
import { defineFlow, FlowEngine, parallel } from "../../src/index.ts";
import { EventSpy, sleep } from "../helpers/test-helpers.ts";

describe("FlowEngine", () => {
    test("runs a simple registered flow and emits lifecycle events", async () => {
        const spy = new EventSpy();
        const engine = new FlowEngine({ subscribers: [spy.subscriber] });
        const flow = defineFlow<{ userId: string }, { userId?: string; saved?: boolean }>({
            id: "sync-user",
            steps: [
                {
                    kind: "step",
                    id: "load-user",
                    name: "load-user",
                    run: (ctx) => {
                        ctx.state.set("userId", ctx.params.userId);
                    },
                    use: [],
                },
                {
                    kind: "step",
                    id: "save-user",
                    name: "save-user",
                    run: (ctx) => {
                        if (!ctx.state.get("userId")) {
                            throw new Error("missing user");
                        }
                        ctx.state.set("saved", true);
                    },
                    use: [],
                },
            ],
        });

        engine.register(flow);

        const result = await engine.run("sync-user", { userId: "u1" });

        expect(result.status).toBe("completed");
        expect(result.state).toEqual({ userId: "u1", saved: true });
        expect(result.steps.map((step) => step.status)).toEqual(["completed", "completed"]);
        expect(spy.byType("flow.started")).toHaveLength(1);
        expect(spy.byType("flow.ended")).toHaveLength(1);
        expect(spy.byType("step.started")).toHaveLength(2);
        expect(spy.byType("step.ended")).toHaveLength(2);
    });

    test("retries then succeeds", async () => {
        const engine = new FlowEngine();
        let attempts = 0;
        const flow = defineFlow<undefined, { attempts?: number }>({
            id: "retry-flow",
            steps: [
                {
                    kind: "step",
                    id: "flaky",
                    name: "flaky",
                    retry: { attempts: 3, delayMs: 1 },
                    use: [],
                    run: (ctx) => {
                        attempts += 1;
                        ctx.state.set("attempts", attempts);
                        if (attempts < 3) {
                            throw new Error("transient");
                        }
                    },
                },
            ],
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("completed");
        expect(attempts).toBe(3);
        expect(result.steps[0]?.attempts).toBe(3);
    });

    test("skips a step when onError says skip", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { recovered?: boolean }>({
            id: "skip-flow",
            steps: [
                {
                    kind: "step",
                    id: "optional",
                    name: "optional",
                    onError: "skip",
                    use: [],
                    run: () => {
                        throw new Error("optional failed");
                    },
                },
                {
                    kind: "step",
                    id: "finish",
                    name: "finish",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("recovered", true);
                    },
                },
            ],
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("completed");
        expect(result.steps.map((step) => step.status)).toEqual(["skipped", "completed"]);
        expect(result.state.recovered).toBe(true);
    });

    test("stops early when a step calls ctx.stop", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { after?: boolean }>({
            id: "stop-flow",
            steps: [
                {
                    kind: "step",
                    id: "gate",
                    name: "gate",
                    use: [],
                    run: (ctx) => {
                        ctx.stop("nothing to do");
                    },
                },
                {
                    kind: "step",
                    id: "after",
                    name: "after",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("after", true);
                    },
                },
            ],
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("completed");
        expect(result.stopReason).toBe("nothing to do");
        expect(result.state.after).toBeUndefined();
        expect(result.steps).toHaveLength(1);
    });

    test("cancels an active run and reports cancelled status", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { finished?: boolean }>({
            id: "cancel-flow",
            steps: [
                {
                    kind: "step",
                    id: "long-step",
                    name: "long-step",
                    use: [],
                    run: async (ctx) => {
                        await sleep(50, ctx.signal);
                        ctx.state.set("finished", true);
                    },
                },
            ],
        });

        const handle = engine.start(flow, undefined);
        await handle.cancel("user cancelled");
        const result = await handle.join();

        expect(result.status).toBe("cancelled");
        expect(result.cancelReason).toBe("user cancelled");
        expect(result.state.finished).toBeUndefined();
    });

    test("pauses before the next node and can resume", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { order?: string[] }>({
            id: "pause-flow",
            initialState: { order: [] },
            steps: [
                {
                    kind: "step",
                    id: "first",
                    name: "first",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("order", [...(ctx.state.get("order") ?? []), "first"]);
                    },
                },
                {
                    kind: "step",
                    id: "second",
                    name: "second",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("order", [...(ctx.state.get("order") ?? []), "second"]);
                    },
                },
            ],
        });

        const handle = engine.start(flow, undefined);
        await handle.pause();

        expect(handle.status()).toBe("paused");

        await handle.resume();
        const result = await handle.join();

        expect(result.status).toBe("completed");
        expect(result.state.order).toEqual(["first", "second"]);
    });

    test("fails when parallel branches write conflicting keys", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { value?: number }>({
            id: "parallel-collision",
            steps: [
                parallel(
                    "collision",
                    [
                        {
                            kind: "step",
                            id: "a",
                            name: "a",
                            use: [],
                            run: (ctx) => {
                                ctx.state.set("value", 1);
                            },
                        },
                        {
                            kind: "step",
                            id: "b",
                            name: "b",
                            use: [],
                            run: (ctx) => {
                                ctx.state.set("value", 2);
                            },
                        },
                    ],
                    { mode: "all-settled" }
                ),
            ],
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("failed");
        expect(result.error?.name).toBe("ParallelMergeError");
    });

    test("returns final state after onSuccess and onComplete mutations", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { audit: string[] }>({
            id: "hooks-final-state",
            initialState: { audit: [] },
            steps: [
                {
                    kind: "step",
                    id: "main",
                    name: "main",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("audit", [...ctx.state.snapshot().audit, "step"]);
                    },
                },
            ],
            onSuccess: (ctx) => {
                ctx.state.set("audit", [...ctx.state.snapshot().audit, "success"]);
            },
            onComplete: (ctx) => {
                ctx.state.set("audit", [...ctx.state.snapshot().audit, "complete"]);
            },
        });

        const result = await engine.run(flow, undefined);

        expect(result.state.audit).toEqual(["step", "success", "complete"]);
    });

    test("preserves lifecycle order for success hooks and reporter events", async () => {
        const trace: string[] = [];
        const engine = new FlowEngine({
            subscribers: [(events) => {
                events.onAny((type) => trace.push(`report:${type}`));
            }],
        });

        const flow = defineFlow<undefined, { done?: boolean }>({
            id: "success-lifecycle-order",
            steps: [
                {
                    kind: "step",
                    id: "main",
                    name: "main",
                    use: [],
                    run: (ctx) => {
                        trace.push("step:run");
                        ctx.state.set("done", true);
                    },
                },
            ],
            onStart: () => {
                trace.push("hook:onStart");
            },
            onSuccess: () => {
                trace.push("hook:onSuccess");
            },
            onComplete: () => {
                trace.push("hook:onComplete");
            },
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("completed");
        expect(trace).toEqual([
            "report:flow.started",
            "hook:onStart",
            "report:step.started",
            "step:run",
            "report:step.ended",
            "hook:onSuccess",
            "report:flow.ended",
            "hook:onComplete",
        ]);
    });

    test("preserves lifecycle order for failure hooks and reporter events", async () => {
        const trace: string[] = [];
        const engine = new FlowEngine({
            subscribers: [(events) => {
                events.onAny((type) => trace.push(`report:${type}`));
            }],
        });

        const flow = defineFlow<undefined, object>({
            id: "failure-lifecycle-order",
            steps: [
                {
                    kind: "step",
                    id: "main",
                    name: "main",
                    use: [],
                    run: () => {
                        trace.push("step:run");
                        throw new Error("boom");
                    },
                },
            ],
            onSuccess: () => {
                trace.push("hook:onSuccess");
            },
            onFailure: (_ctx, error) => {
                trace.push(`hook:onFailure:${error.message}`);
            },
            onComplete: (_ctx, result) => {
                trace.push(`hook:onComplete:${result.status}`);
            },
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("failed");
        expect(result.error?.message).toBe("boom");
        expect(trace).toEqual([
            "report:flow.started",
            "report:step.started",
            "step:run",
            "report:step.ended",
            "hook:onFailure:boom",
            "report:flow.ended",
            "hook:onComplete:failed",
        ]);
        expect(trace).not.toContain("hook:onSuccess");
    });

    test("stops scheduling remaining parallel branches in fail-fast mode", async () => {
        const engine = new FlowEngine();
        let secondBranchRan = false;

        const flow = defineFlow<undefined, object>({
            id: "parallel-fail-fast",
            steps: [
                parallel(
                    "race",
                    [
                        {
                            kind: "step",
                            id: "first",
                            name: "first",
                            use: [],
                            run: () => {
                                throw new Error("branch failed");
                            },
                        },
                        {
                            kind: "step",
                            id: "second",
                            name: "second",
                            use: [],
                            run: () => {
                                secondBranchRan = true;
                            },
                        },
                    ],
                    { mode: "fail-fast", concurrency: 1 }
                ),
            ],
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("failed");
        expect(result.error?.message).toBe("branch failed");
        expect(secondBranchRan).toBe(false);
    });

    test("cancels cleanly while paused before the next node", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { order?: string[] }>({
            id: "cancel-while-paused",
            initialState: { order: [] },
            steps: [
                {
                    kind: "step",
                    id: "first",
                    name: "first",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("order", [...(ctx.state.get("order") ?? []), "first"]);
                    },
                },
                {
                    kind: "step",
                    id: "second",
                    name: "second",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("order", [...(ctx.state.get("order") ?? []), "second"]);
                    },
                },
            ],
        });

        const handle = engine.start(flow, undefined);
        await handle.pause();

        expect(handle.status()).toBe("paused");

        await handle.cancel("paused cancel");
        const result = await handle.join();

        expect(result.status).toBe("cancelled");
        expect(result.cancelReason).toBe("paused cancel");
        expect(result.state.order).toEqual(["first"]);
    });

    test("runs onSuccess and onComplete after ctx.stop when not cancelled", async () => {
        const trace: string[] = [];
        const engine = new FlowEngine({
            subscribers: [(events) => {
                events.onAny((type) => trace.push(`report:${type}`));
            }],
        });

        const flow = defineFlow<undefined, { audit: string[] }>({
            id: "stop-hooks-order",
            initialState: { audit: [] },
            steps: [
                {
                    kind: "step",
                    id: "main",
                    name: "main",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("audit", [...ctx.state.snapshot().audit, "step"]);
                        trace.push("step:stop");
                        ctx.stop("done early");
                    },
                },
                {
                    kind: "step",
                    id: "after",
                    name: "after",
                    use: [],
                    run: (ctx) => {
                        ctx.state.set("audit", [...ctx.state.snapshot().audit, "after"]);
                    },
                },
            ],
            onSuccess: (ctx) => {
                trace.push("hook:onSuccess");
                ctx.state.set("audit", [...ctx.state.snapshot().audit, "success"]);
            },
            onComplete: (ctx, result) => {
                trace.push(`hook:onComplete:${result.status}`);
                ctx.state.set("audit", [...ctx.state.snapshot().audit, "complete"]);
            },
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("completed");
        expect(result.stopReason).toBe("done early");
        expect(result.state.audit).toEqual(["step", "success", "complete"]);
        expect(trace).toEqual([
            "report:flow.started",
            "report:step.started",
            "step:stop",
            "report:step.ended",
            "hook:onSuccess",
            "report:flow.ended",
            "hook:onComplete:completed",
        ]);
    });

    test("supports append-arrays merge strategy in parallel", async () => {
        const engine = new FlowEngine();
        const flow = defineFlow<undefined, { audit?: string[] }>({
            id: "parallel-append",
            steps: [
                parallel(
                    "append",
                    [
                        {
                            kind: "step",
                            id: "a",
                            name: "a",
                            use: [],
                            run: (ctx) => {
                                ctx.state.set("audit", ["a"]);
                            },
                        },
                        {
                            kind: "step",
                            id: "b",
                            name: "b",
                            use: [],
                            run: (ctx) => {
                                ctx.state.set("audit", ["b"]);
                            },
                        },
                    ],
                    {
                        mode: "all-settled",
                        merge: { strategy: "arrays" },
                    }
                ),
            ],
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("completed");
        expect(result.state.audit).toEqual(["a", "b"]);
    });

    test("emits attempt events for retries", async () => {
        const spy = new EventSpy();
        const engine = new FlowEngine({ subscribers: [spy.subscriber] });
        let attempts = 0;

        const flow = defineFlow<undefined, object>({
            id: "attempt-events",
            steps: [
                {
                    kind: "step",
                    id: "retrying",
                    name: "retrying",
                    retry: { attempts: 2, delayMs: 1 },
                    use: [],
                    run: () => {
                        attempts += 1;
                        if (attempts === 1) {
                            throw new Error("fail once");
                        }
                    },
                },
            ],
        });

        const result = await engine.run(flow, undefined);

        expect(result.status).toBe("completed");
        expect(spy.byType("step.started")).toHaveLength(2);
        expect(spy.byType("step.ended")).toHaveLength(2);
        expect(spy.byType("step.retrying")).toHaveLength(1);
    });
});
