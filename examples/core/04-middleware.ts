/**
 * 04-middleware.ts — Middleware
 *
 * Covers:
 *  - Universal middleware: a Middleware<FlowContext> / Middleware<TaskContext>
 *    value that works in any flow
 *  - Shape-typed middleware: shape.flowMiddleware / shape.taskMiddleware,
 *    which gives typed access to the shape's params/state inside the handler
 *  - Patterns: transaction wrap, timing, feature flag (short-circuit),
 *    skip-if-condition
 *  - Composition order: outer -> inner around next()
 *
 * Retry, onError and other node options live in 02-nodes.ts.
 */

import { createEngine, type FlowContext, type Middleware, shape, type TaskContext } from "@flowrun/core";
import { delay, log, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// ── Shape ──────────────────────────────────────────────────────────

interface OrderParams {
    orderId: string;
}

interface OrderState {
    charged: boolean;
    orderId: string;
    validated: boolean;
}

interface OrderContract {
    params: OrderParams;
    state: OrderState;
}

const order = shape<OrderContract>();

// ── Stubs ──────────────────────────────────────────────────────────

function beginTransaction(): Promise<{
    commit(): Promise<void>;
    rollback(): Promise<void>;
}> {
    return Promise.resolve({
        commit: () => Promise.resolve(),
        rollback: () => Promise.resolve(),
    });
}

// ── Universal flow middleware (works in any flow) ──────────────────
// Typed against the base FlowContext, so it stays assignable to any
// flow's middleware slot regardless of its params/state shape.

const withTransaction: Middleware<FlowContext> = {
    name: "with-transaction",
    run: async (context, next) => {
        const transaction = await beginTransaction();
        context.log.info("transaction started");
        try {
            await next();
            await transaction.commit();
            context.log.info("transaction committed");
        } catch (error) {
            await transaction.rollback();
            context.log.error("transaction rolled back", { error });
            throw error;
        }
    },
};

const flowTiming: Middleware<FlowContext> = {
    name: "flow-timing",
    run: async (context, next) => {
        const start = Date.now();
        await next();
        context.log.info(`flow completed in ${Date.now() - start}ms`);
    },
};

let featureEnabled = true;

const featureFlag: Middleware<FlowContext> = {
    name: "feature-flag",
    run: async (context, next) => {
        if (!featureEnabled) {
            context.log.info(`flow "${context.flowName}" disabled by feature flag - skipping`);
            return; // short-circuit: does not call next()
        }
        await next();
    },
};

// ── Universal task middleware (works in any task) ──────────────────

const taskTiming: Middleware<TaskContext> = {
    name: "task-timing",
    run: async (context, next) => {
        const start = Date.now();
        await next();
        context.log.info(`task "${context.nodeName}": ${Date.now() - start}ms`);
    },
};

// ── Shape-typed flow middleware (typed access to params/state) ────

const orderAuditor = order.flowMiddleware({
    name: "order-auditor",
    run: async (context, next) => {
        context.log.info(`audit start: order ${context.params.orderId}`);
        await next();
        const charged = context.state.get("charged");
        context.log.info(`audit end: order ${context.params.orderId} (charged=${charged})`);
        if (!charged) {
            context.log.warn("audit warning: order completed without charge", {
                charged,
                orderId: context.params.orderId,
            });
        }
    },
});

// ── Shape-typed task middleware (typed access to state) ───────────

const skipIfCharged = order.taskMiddleware({
    name: "skip-if-charged",
    run: async (context, next) => {
        if (context.state.get("charged")) {
            context.log.info(`skipping "${context.nodeName}" - order already charged`);
            return;
        }
        await next();
    },
});

// ── Flow with middleware ───────────────────────────────────────────

const orderPipeline = order
    .flow("order-pipeline")
    .state((params) => ({
        charged: false,
        orderId: params.orderId,
        validated: false,
    }))
    .middleware([featureFlag, withTransaction, flowTiming, orderAuditor])
    .nodes(({ task }) => [
        task({
            name: "validate-order",
            middleware: [taskTiming],
            run: async (context) => {
                await delay(10);
                context.state.set("validated", true);
            },
        }),
        task({
            name: "charge-payment",
            middleware: [taskTiming, skipIfCharged],
            run: async (context) => {
                await delay(10);
                context.state.set("charged", true);
            },
        }),
        task({
            name: "confirm",
            middleware: [taskTiming],
            run: (context) => {
                context.log.info(`order ${context.state.get("orderId")} confirmed`);
            },
        }),
    ]);

// ── Engine ─────────────────────────────────────────────────────────

const engine = createEngine();
subscriber(engine.bus);

// register() returns a typed Flow handle and adds order-pipeline to the registry,
// so Run 2 below can dispatch by name.
const orderRunner = engine.register(orderPipeline);

// ── Run 1: feature enabled — full middleware chain ────────────────

title("Run 1 - Feature enabled (full middleware chain)");
const result1 = await orderRunner.run({ orderId: "ORD-001" });
log("\nFinal state:", result1.state);
log(`Tasks: ${result1.tasks.map((result) => `${result.nodeName}(${result.status})`).join(", ")}`);

// ── Run 2: feature disabled — flow short-circuited by middleware ──
// engine.flow(name) is the dynamic by-name path (type-erased).

title("Run 2 - Feature disabled (short-circuit, by name)");
featureEnabled = false;
const result2 = await engine.flow("order-pipeline").run({ orderId: "ORD-002" });
log("\nFinal state:", result2.state);
log(`Duration: ${result2.duration}ms`);
