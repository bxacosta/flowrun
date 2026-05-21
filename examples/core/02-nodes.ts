/**
 * 02-nodes.ts — Node Types & Options
 *
 * One section per node type, focused on the options each node exposes.
 * Composition (containers inside containers) lives in 03-composition.ts.
 *
 * Covers:
 *  - task: sync/async run, retry (constant + exponential w/ jitter, factor,
 *          maxDelayMs, retryOn), onError:"skip", context.skip(), context.attempt
 *  - parallel: merge strategies (overwrite, append, strict -> MergeConflictError)
 *  - every: items source, concurrency, merge, onError:"continue", context.iteration
 */

import { createEngine, flow } from "@flowrun/core";
import { delay, log, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// ─────────────────────────────────────────────────────────────────────
// Task — run, retry, onError, context.attempt, context.skip()
// ─────────────────────────────────────────────────────────────────────

let constantFails = 2; // succeeds on attempt #3
let exponentialFails = 1; // succeeds on attempt #2

const taskShowcase = flow("task-showcase")
    .state({ steps: [] as string[] })
    .nodes(({ task }) => [
        // Sync run — simplest form
        task({
            name: "sync-step",
            run: (context) => {
                context.state.append("steps", "sync-ok");
            },
        }),

        // Async run
        task({
            name: "async-step",
            run: async (context) => {
                await delay(10);
                context.state.append("steps", "async-ok");
            },
        }),

        // Constant backoff — same delay between every attempt
        task({
            name: "retry-constant",
            retry: { attempts: 3, backoff: "constant", delayMs: 10 },
            run: (context) => {
                if (constantFails > 0) {
                    constantFails--;
                    throw new Error("flaky");
                }
                context.state.append("steps", `constant-ok@${context.attempt}`);
            },
        }),

        // Exponential backoff with jitter, max delay cap, and a retryOn filter
        task({
            name: "retry-exponential",
            retry: {
                attempts: 4,
                backoff: "exponential",
                delayMs: 20,
                factor: 2,
                jitter: true,
                maxDelayMs: 200,
                retryOn: (error) => error.message.includes("timeout"),
            },
            run: (context) => {
                if (exponentialFails > 0) {
                    exponentialFails--;
                    throw new Error("connection timeout");
                }
                context.state.append("steps", `exponential-ok@${context.attempt}`);
            },
        }),

        // onError:"skip" — task fails after retries, but the flow continues
        task({
            name: "best-effort",
            onError: "skip",
            retry: { attempts: 2, backoff: "constant", delayMs: 5 },
            run: () => {
                throw new Error("never works");
            },
        }),

        // context.skip(reason) — task validates and bails cleanly (no error thrown)
        task({
            name: "skip-when-not-applicable",
            run: (context) => {
                const shouldRun = false; // imagine this comes from a validation check
                if (!shouldRun) {
                    context.skip("input did not match preconditions");
                }
                context.state.set("steps", [...context.state.get("steps"), "should-not-appear"]);
            },
        }),

        // Final task observes that both skips did not kill the flow
        task({
            name: "after-skip",
            run: (context) => {
                context.state.append("steps", "after-skip-ok");
            },
        }),
    ]);

// ─────────────────────────────────────────────────────────────────────
// Parallel — merge strategies
// ─────────────────────────────────────────────────────────────────────

// overwrite: same key from N branches -> last write wins
const overwriteDemo = flow("overwrite-demo")
    .state({ winner: "" })
    .nodes(({ parallel }) => [
        parallel({
            name: "race",
            merge: "overwrite",
            nodes: ({ task }) => [
                task({
                    name: "branch-a",
                    run: (context) => {
                        context.state.set("winner", "branch-a");
                    },
                }),
                task({
                    name: "branch-b",
                    run: (context) => {
                        context.state.set("winner", "branch-b");
                    },
                }),
            ],
        }),
    ]);

// append: arrays from each branch concatenated
const appendDemo = flow("append-demo")
    .state({ items: [] as string[] })
    .nodes(({ parallel }) => [
        parallel({
            name: "collect",
            merge: "append",
            nodes: ({ task }) => [
                task({
                    name: "source-a",
                    run: (context) => {
                        context.state.set("items", ["a1", "a2"]);
                    },
                }),
                task({
                    name: "source-b",
                    run: (context) => {
                        context.state.set("items", ["b1", "b2"]);
                    },
                }),
            ],
        }),
    ]);

// strict: same key from 2 branches -> MergeConflictError
const strictDemo = flow("strict-demo")
    .state({ shared: "" })
    .nodes(({ parallel }) => [
        parallel({
            name: "will-conflict",
            merge: "strict",
            nodes: ({ task }) => [
                task({
                    name: "writer-a",
                    run: (context) => {
                        context.state.set("shared", "from-a");
                    },
                }),
                task({
                    name: "writer-b",
                    run: (context) => {
                        context.state.set("shared", "from-b");
                    },
                }),
            ],
        }),
    ]);

// continue: one branch fails, successful branches still merge — flow survives
const continueDemo = flow("continue-demo")
    .state({ collected: [] as string[] })
    .nodes(({ parallel }) => [
        parallel({
            name: "tolerant",
            merge: "append",
            onError: "continue",
            nodes: ({ task }) => [
                task({
                    name: "branch-ok-1",
                    run: (context) => {
                        context.state.set("collected", ["ok-1"]);
                    },
                }),
                task({
                    name: "branch-fails",
                    run: () => {
                        throw new Error("branch failed but flow survives");
                    },
                }),
                task({
                    name: "branch-ok-2",
                    run: (context) => {
                        context.state.set("collected", ["ok-2"]);
                    },
                }),
            ],
        }),
    ]);

// ─────────────────────────────────────────────────────────────────────
// Every — items source, concurrency, iteration context, onError
// ─────────────────────────────────────────────────────────────────────

const everyShowcase = flow("every-showcase")
    .state({
        ordered: [] as string[],
        resilient: [] as string[],
        sourceItems: ["x1", "x2", "x3", "x4"],
    })
    .nodes(({ every }) => [
        // items pulled from state, bounded concurrency, iteration context
        every({
            name: "process-from-state",
            items: (context) => context.state.get("sourceItems"),
            concurrency: 2,
            merge: "append",
            nodes: ({ task }) => [
                task({
                    name: "handle",
                    run: async (context) => {
                        await delay(5);
                        const { index, item } = context.iteration;
                        context.state.set("ordered", [`#${index}=${item}`]);
                    },
                }),
            ],
        }),

        // items as inline array, onError:"continue" — failed items do not break the rest
        every({
            name: "resilient-pass",
            items: () => ["ok-1", "FAIL", "ok-2"],
            concurrency: 1,
            merge: "append",
            onError: "continue",
            nodes: ({ task }) => [
                task({
                    name: "maybe-fail",
                    run: (context) => {
                        if (context.iteration.item === "FAIL") {
                            throw new Error("item failed");
                        }
                        context.state.set("resilient", [context.iteration.item]);
                    },
                }),
            ],
        }),
    ]);

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();
subscriber(engine.bus);

// ── Run ─────────────────────────────────────────────────────────────

title("Task - sync/async + retry + onError:skip + context.skip() + context.attempt");
const taskResult = await engine.run(taskShowcase);
log("steps:", taskResult.state.steps);
log("tasks:");
for (const result of taskResult.tasks) {
    const reason = result.reason ? ` (${result.reason})` : "";
    log(`  ${result.nodeName} -> ${result.status}${reason} (attempts=${result.attempts})`);
}

title("Parallel - overwrite (last write wins)");
const overwriteResult = await engine.run(overwriteDemo);
log("winner:", overwriteResult.state.winner);

title("Parallel - append (arrays concatenated)");
const appendResult = await engine.run(appendDemo);
log("items:", appendResult.state.items);

title("Parallel - strict (conflict -> MergeConflictError)");
const strictResult = await engine.run(strictDemo);
if (strictResult.status === "failed") {
    log("expected error:", strictResult.error.message);
}

title("Parallel - continue (one branch fails, successful merges survive)");
const continueResult = await engine.run(continueDemo);
if (continueResult.status === "success") {
    log("collected (failed branch dropped):", continueResult.state.collected);
}

title("Every - items + concurrency + iteration context + onError:continue");
const everyResult = await engine.run(everyShowcase);
if (everyResult.status === "success") {
    log("ordered results:", everyResult.state.ordered);
    log("resilient results:", everyResult.state.resilient);
    log(
        "tasks:",
        everyResult.tasks
            .map((result) => `${result.nodeName}[${result.iteration?.item}] -> ${result.status}`)
            .join(", ")
    );
}
