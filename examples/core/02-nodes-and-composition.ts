/**
 * 02-nodes-and-composition.ts — Node Types & Composition
 *
 * Covers:
 *  - parallel() with merge strategies: overwrite (same key → last wins), append, strict (conflict)
 *  - every() with items from state, external items, concurrency, iteration context
 *  - Deep nesting: parallel → every (items from state), parallel → parallel
 *  - Container onError: "continue" (resilient iteration)
 *  - EachScope, context.iteration.item / context.iteration.index
 */

import {createEngine, defineEvery, defineFlow, defineParallel, defineTask, type EmptyObject} from "@flowrun/core"
import type { FlowScope, IterationScope } from "@flowrun/core"
import { delay, log, title } from "./shared/helpers.ts";

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();

// ─────────────────────────────────────────────────────────────────────
// Flow 1: parallel merge strategies
// ─────────────────────────────────────────────────────────────────────

// overwrite: both branches write "winner" — last write wins

const overwriteDemo = engine.flow({
    name: "overwrite-demo",
    state: () => ({ winner: "" }),

    nodes: ({ parallel }) => [
        parallel({
            name: "race",
            merge: "overwrite",
            nodes: ({ task }) => [
                task({
                    name: "branch-a",
                    handler: (context) => {
                        context.state.set("winner", "branch-a");
                    },
                }),
                task({
                    name: "branch-b",
                    handler: (context) => {
                        context.state.set("winner", "branch-b");
                    },
                }),
            ],
        }),
    ],
});

// append: arrays from each branch concatenated

const appendDemo = engine.flow({
    name: "append-demo",
    state: () => ({ items: [] as string[] }),

    nodes: ({ parallel }) => [
        parallel({
            name: "collect",
            merge: "append",
            nodes: ({ task }) => [
                task({
                    name: "source-a",
                    handler: (context) => {
                        context.state.set("items", ["a1", "a2"]);
                    },
                }),
                task({
                    name: "source-b",
                    handler: (context) => {
                        context.state.set("items", ["b1", "b2"]);
                    },
                }),
            ],
        }),
    ],
});

// strict: same key from 2 branches → MergeConflictError

const strictDemo = engine.flow({
    name: "strict-demo",
    state: () => ({ shared: "" }),

    nodes: ({ parallel }) => [
        parallel({
            name: "will-conflict",
            merge: "strict",
            nodes: ({ task }) => [
                task({
                    name: "writer-a",
                    handler: (context) => {
                        context.state.set("shared", "from-a");
                    },
                }),
                task({
                    name: "writer-b",
                    handler: (context) => {
                        context.state.set("shared", "from-b");
                    },
                }),
            ],
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 2: every + onError:"continue" — one item fails, rest continue
// ─────────────────────────────────────────────────────────────────────

const resilientPipeline = engine.flow({
    name: "resilient-pipeline",
    state: () => ({ results: [] as string[] }),

    nodes: ({ every }) => [
        every({
            name: "process-items",
            items: () => ["ok-1", "FAIL", "ok-2", "ok-3"],
            concurrency: 1,
            merge: "append",
            onError: "continue",
            nodes: ({ task }) => [
                task({
                    name: "handle-item",
                    handler: (context) => {
                        if (context.iteration.item === "FAIL") {
                            throw new Error("item processing failed");
                        }
                        context.state.set("results", [context.iteration.item]);
                    },
                }),
            ],
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 3: deep nesting with Define API (defineTask, defineEvery, defineParallel, defineFlow)
// ─────────────────────────────────────────────────────────────────────

// ── Types ───────────────────────────────────────────────────────────

type OrderItem = {
    productId: string;
    quantity: number
};

type OrderState = {
    discountTotal: number;
    itemResults: string[];
    orderItems: OrderItem[];
    revenueTotal: number;
};

type OrderScope = FlowScope<typeof engine, EmptyObject, OrderState>;

type OrderItemScope = IterationScope<OrderScope, OrderItem>;


// ── Definitions ─────────────────────────────────────────────────────

// Step 1: task that populates order items into state

const loadOrder = defineTask<OrderScope>({
    name: "load-order",
    handler: (context) => {
        context.state.set("orderItems", [
            { productId: "p1", quantity: 3 },
            { productId: "p2", quantity: 1 },
            { productId: "p3", quantity: 5 },
        ]);
    },
});

// Branch A: every inside parallel — iterate order items from state

const calculateLine = defineTask<OrderItemScope>({
    name: "calculate-line",
    handler: async (context) => {
        const item = context.iteration.item;
        await delay(10);
        context.state.set("itemResults", [`${item.productId} x${item.quantity}`]);
    },
});

const processLineItems = defineEvery<OrderScope, OrderItem>({
    name: "process-line-item",
    items: (context) => context.state.get("orderItems"),
    concurrency: 2,
    merge: "append",
    nodes: [calculateLine],
});

// Branch B: parallel inside parallel — independent summary calculations

const revenueSummary = defineTask<OrderScope>({
    name: "revenue-summary",
    handler: async (context) => {
        await delay(10);
        context.state.set("revenueTotal", 99.94);
    },
});

const discountSummary = defineTask<OrderScope>({
    name: "discount-summary",
    handler: async (context) => {
        await delay(10);
        context.state.set("discountTotal", 12.50);
    },
});

const computeSummaries = defineParallel<OrderScope>({
    name: "compute-summaries",
    merge: "overwrite",
    nodes: [revenueSummary, discountSummary],
});

// Step 2: parallel wrapping every + nested parallel

const processOrder = defineParallel<OrderScope>({
    name: "process-order",
    merge: "overwrite",
    nodes: [processLineItems, computeSummaries],
});

// Compose into a flow definition and register

const orderDefinition = defineFlow<OrderScope>({
    name: "order-pipeline",
    state: () => ({
        discountTotal: 0,
        itemResults: [] as string[],
        orderItems: [] as OrderItem[],
        revenueTotal: 0,
    }),
    nodes: [loadOrder, processOrder],
});

const orderPipeline = engine.flow(orderDefinition);

// ── Run ─────────────────────────────────────────────────────────────

title("1 · Parallel + overwrite (same key → last wins)");
const overwriteResult = await overwriteDemo.run();
log("winner:", overwriteResult.state.winner);

title("1 · Parallel + append");
const appendResult = await appendDemo.run();
log("items:", appendResult.state.items);

title("1 · Parallel + strict (conflict → MergeConflictError)");
const strictResult = await strictDemo.run();
if (strictResult.status === "failed") {
    log("Expected error:", strictResult.error.message);
}

title("2 · Every + onError:continue (resilient)");
const resilientResult = await resilientPipeline.run();
log(`status: ${resilientResult.status}`);
log("results:", resilientResult.state.results);
log(
    "tasks:",
    resilientResult.tasks
        .map((result) => `${result.nodeName}[${result.iteration?.item}] → ${result.status}`)
        .join(", "),
);

title("3 · Deep nesting (items from state + parallel → every + parallel)");
const orderResult = await orderPipeline.run();
if (orderResult.status === "success") {
    log("line items:", orderResult.state.itemResults);
    log(`revenue: $${orderResult.state.revenueTotal}`);
    log(`discounts: $${orderResult.state.discountTotal}`);
}
