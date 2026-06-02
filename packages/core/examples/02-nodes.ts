/**
 * 02-nodes.ts — Node Types & Options
 *
 * Covers:
 *  - task: retry (constant + exponential w/ jitter, factor, maxDelayMs, retryOn),
 *          onError:"ignore", context.skip(), context.attempt
 *  - the full state store API, one method per step of an order pipeline:
 *          set, get, append, update, patch, has, snapshot
 *  - parallel: merge strategies (overwrite, append, exclusive -> MergeConflictError)
 *  - each: items source, concurrency, merge, onError:"ignore", context.iteration
 */

import { createEngine, flow } from "@flowrun/core";
import { delay, log, logResult, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

const engine = createEngine();
subscriber(engine.events);

// ─────────────────────────────────────────────────────────────────────
// Task - an order pipeline covering the state API, retry, skip and onError
// ─────────────────────────────────────────────────────────────────────

const orderPipeline = flow("order-pipeline")
    .state({
        audit: [] as string[],
        lines: [] as { amount: number; sku: string }[],
        status: "new",
        total: 0,
    })
    .nodes(({ task }) => [
        // state.set - overwrite a single key
        task({
            name: "validate",
            run: (context) => {
                context.state.set("status", "validated");
            },
        }),

        // state.set - seed an array key
        task({
            name: "load-lines",
            run: (context) => {
                context.state.set("lines", [
                    { amount: 40, sku: "WIDGET" },
                    { amount: 60, sku: "GADGET" },
                ]);
            },
        }),

        // state.append - push one element onto an existing array
        task({
            name: "add-shipping",
            run: (context) => {
                context.state.append("lines", { amount: 10, sku: "SHIPPING" });
            },
        }),

        // state.get - read a key, derive a value, write it back with set
        task({
            name: "compute-total",
            run: (context) => {
                const subtotal = context.state.get("lines").reduce((sum, line) => sum + line.amount, 0);
                context.state.set("total", subtotal);
            },
        }),

        // state.update - read-modify-write; constant backoff retry + context.attempt
        task({
            name: "apply-exchange-rate",
            retry: { backoff: "constant", delayMs: 10, maxAttempts: 3 },
            run: (context) => {
                if (context.attempt < 2) {
                    throw new Error("exchange-rate service unavailable");
                }
                context.state.update("total", (current) => Math.round(current * 1.05));
                context.state.append("audit", `rate applied on attempt ${context.attempt}`);
            },
        }),

        // Exponential backoff with jitter, a max-delay cap, and a retryOn filter
        task({
            name: "charge",
            retry: {
                backoff: "exponential",
                delayMs: 20,
                factor: 2,
                jitter: true,
                maxAttempts: 4,
                maxDelayMs: 200,
                retryOn: (error) => error.message.includes("timeout"),
            },
            run: (context) => {
                if (context.attempt < 2) {
                    throw new Error("gateway timeout");
                }
                context.state.set("status", "charged");
            },
        }),

        // context.skip(reason) - bail out cleanly when a step doesn't apply
        task({
            name: "gift-wrap",
            run: (context) => {
                const wantsGiftWrap = false; // imagine this comes from the order
                if (!wantsGiftWrap) {
                    context.skip("no gift wrap requested");
                }
                context.state.append("lines", { amount: 5, sku: "GIFT-WRAP" });
            },
        }),

        // onError:"ignore" - best-effort side effect; failure doesn't stop the flow
        task({
            name: "send-receipt",
            onError: "ignore",
            retry: { backoff: "constant", delayMs: 5, maxAttempts: 2 },
            run: () => {
                throw new Error("email provider down");
            },
        }),

        // state.has + state.patch + state.snapshot
        task({
            name: "finalize",
            run: (context) => {
                if (context.state.has("total")) {
                    context.state.patch({ status: "completed" });
                }
                context.state.append("audit", "finalized");
                context.log.info("final order", { snapshot: context.state.snapshot() });
            },
        }),
    ]);

title("Task - state API tour + retry + skip + onError:ignore + context.attempt");
const orderResult = await engine.run(orderPipeline);
if (orderResult.status === "success") {
    log("final status:", orderResult.state.status);
    log("total:", orderResult.state.total);
    log("lines:", orderResult.state.lines.map((line) => `${line.sku}:${line.amount}`).join(", "));
    log("audit:", orderResult.state.audit);
}
logResult(orderResult);

// ─────────────────────────────────────────────────────────────────────
// Parallel - merge strategies
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

title("Parallel - overwrite (last write wins)");
const overwriteResult = await engine.run(overwriteDemo);
log("winner:", overwriteResult.state.winner);

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

title("Parallel - append (arrays concatenated)");
const appendResult = await engine.run(appendDemo);
log("items:", appendResult.state.items);

// exclusive: same key from 2 branches -> MergeConflictError
const strictDemo = flow("strict-demo")
    .state({ shared: "" })
    .nodes(({ parallel }) => [
        parallel({
            name: "will-conflict",
            merge: "exclusive",
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

title("Parallel - exclusive (conflict -> MergeConflictError)");
const strictResult = await engine.run(strictDemo);
if (strictResult.status === "failed") {
    log("expected error:", strictResult.error.message);
}

// ignore: one branch fails, successful branches still merge - flow survives
const continueDemo = flow("continue-demo")
    .state({ collected: [] as string[] })
    .nodes(({ parallel }) => [
        parallel({
            name: "tolerant",
            merge: "append",
            onError: "ignore",
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

title("Parallel - ignore (one branch fails, successful merges survive)");
const continueResult = await engine.run(continueDemo);
if (continueResult.status === "success") {
    log("collected (failed branch dropped):", continueResult.state.collected);
}

// ─────────────────────────────────────────────────────────────────────
// Each - items source, concurrency, iteration context, onError
// ─────────────────────────────────────────────────────────────────────

const eachShowcase = flow("each-showcase")
    .state({
        ordered: [] as string[],
        resilient: [] as string[],
        sourceItems: ["x1", "x2", "x3", "x4"],
    })
    .nodes(({ each }) => [
        // items pulled from state, bounded concurrency, iteration context
        each({
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

        // items as inline array, onError:"ignore" - failed items do not break the rest
        each({
            name: "resilient-pass",
            items: () => ["ok-1", "FAIL", "ok-2"],
            concurrency: 1,
            merge: "append",
            onError: "ignore",
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

title("Each - items + concurrency + iteration + onError:ignore");
const eachResult = await engine.run(eachShowcase);
if (eachResult.status === "success") {
    log("ordered results:", eachResult.state.ordered);
    log("resilient results:", eachResult.state.resilient);
}
logResult(eachResult);
