import { describe, expect, test } from "bun:test";
import {
    defineFlow,
    type FlowEndedEvent,
    FlowEngine,
    type Middleware,
    parallel,
    sequence,
    step,
} from "../../src/index.ts";
import { EventSpy, sleep } from "../helpers/test-helpers.ts";

interface ImportParams {
    customerTier: "standard" | "vip";
    source: string;
}

interface ImportState {
    audit: string[];
    fetched?: boolean;
    normalized?: boolean;
    persisted?: boolean;
    profileLoaded?: boolean;
    recommendationsLoaded?: boolean;
    statsLoaded?: boolean;
}

describe("integration flow", () => {
    test("runs a full flow with middleware, retry, skip, parallel and hooks", async () => {
        const spy = new EventSpy();
        const engine = new FlowEngine({ subscribers: [spy.subscriber] });
        let persistAttempts = 0;
        let onStartCalled = false;
        let onSuccessCalled = false;
        let onCompleteCalled = false;

        const timingMiddleware: Middleware<ImportParams, ImportState> = async (ctx, next) => {
            const startedAt = Date.now();
            await next();
            ctx.emit("log", {
                level: "info",
                message: "timed",
                stepId: ctx.step.id,
                stepName: ctx.step.name,
                data: { durationMs: Date.now() - startedAt },
            });
        };

        const flow = defineFlow<ImportParams, ImportState>({
            id: "customer-import",
            initialState: { audit: [] },
            middleware: [timingMiddleware],
            steps: [
                step("fetch-source", async (ctx) => {
                    await sleep(5, ctx.signal);
                    ctx.state.set("fetched", true);
                    ctx.state.set("audit", [...ctx.state.snapshot().audit, `source:${ctx.params.source}`]);
                }),
                parallel(
                    "load-data",
                    [
                        sequence("profile-pipeline", [
                            step("load-profile", async (ctx) => {
                                await sleep(5, ctx.signal);
                                ctx.state.set("profileLoaded", true);
                            }),
                        ]),
                        sequence("analytics-pipeline", [
                            step("load-stats", async (ctx) => {
                                await sleep(5, ctx.signal);
                                ctx.state.set("statsLoaded", true);
                            }),
                            step(
                                "load-recommendations",
                                async (ctx) => {
                                    await sleep(15, ctx.signal);
                                    ctx.state.set("recommendationsLoaded", true);
                                },
                                {
                                    timeoutMs: 2,
                                    onError: "skip",
                                }
                            ),
                        ]),
                    ],
                    { mode: "all-settled", concurrency: 2 }
                ),
                step("normalize", (ctx) => {
                    expect(ctx.state.get("fetched")).toBe(true);
                    expect(ctx.state.get("profileLoaded")).toBe(true);
                    expect(ctx.state.get("statsLoaded")).toBe(true);
                    expect(ctx.state.get("recommendationsLoaded")).toBeUndefined();
                    ctx.state.set("normalized", true);
                }),
                step(
                    "persist",
                    async (ctx) => {
                        persistAttempts += 1;
                        await sleep(5, ctx.signal);
                        if (persistAttempts === 1) {
                            throw new Error("temporary lock");
                        }
                        ctx.state.set("persisted", true);
                    },
                    {
                        retry: {
                            attempts: 2,
                            delayMs: 1,
                            strategy: "exponential",
                        },
                    }
                ),
            ],
            onStart: (ctx) => {
                onStartCalled = true;
                ctx.state.set("audit", [...ctx.state.snapshot().audit, "started"]);
            },
            onSuccess: (ctx) => {
                onSuccessCalled = true;
                ctx.state.set("audit", [...ctx.state.snapshot().audit, "succeeded"]);
            },
            onComplete: (ctx, result) => {
                onCompleteCalled = true;
                ctx.emit("log", { level: "info", message: "complete", data: { status: result.status } });
            },
        });

        const result = await engine.run(flow, { source: "crm", customerTier: "vip" });

        expect(result.status).toBe("completed");
        expect(result.state).toEqual({
            audit: ["started", "source:crm", "succeeded"],
            fetched: true,
            profileLoaded: true,
            statsLoaded: true,
            normalized: true,
            persisted: true,
        });
        expect(onStartCalled).toBe(true);
        expect(onSuccessCalled).toBe(true);
        expect(onCompleteCalled).toBe(true);
        expect(result.steps).toHaveLength(6);
        expect(result.steps.find((step) => step.stepId === "load-recommendations")?.status).toBe("skipped");
        expect(result.steps.find((step) => step.stepId === "persist")?.attempts).toBe(2);
        expect(spy.byType("step.started")).toHaveLength(7);
        expect(spy.byType("step.ended")).toHaveLength(7);
        expect(spy.byType("step.retrying")).toHaveLength(1);
        expect((spy.byType("flow.ended")[0] as FlowEndedEvent | undefined)?.status).toBe("completed");
    });
});
