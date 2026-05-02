/**
 * 03-middleware-and-retry.ts — Middleware & Retry
 *
 * Covers:
 *  - Flow middleware: universal (Middleware<FlowContext>) and scope-typed (Middleware<FlowContext<Scope>>)
 *  - Task middleware: universal (Middleware<TaskContext>) and scope-typed (Middleware<TaskContext<Scope>>)
 *  - Middleware patterns: transaction wrap, timing, feature flag (short-circuit), skip-if-condition
 *  - Retry: constant backoff, exponential backoff with jitter, retryOn filter, factor, maxDelayMs
 *  - onError: "skip" on tasks
 *  - context.attempt in task context
 */

import { createEngine } from "@flowrun/core"
import type { FlowContext, FlowScope, Middleware, TaskContext } from "@flowrun/core"
import { subscriber } from "./shared/subscriber.ts";
import { delay, log, title } from "./shared/helpers.ts";

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();
subscriber(engine.bus);

// ── Scope ───────────────────────────────────────────────────────────

type OrderParams = { orderId: string };

type OrderState = {
    charged: boolean;
    orderId: string;
    validated: boolean;
};

type OrderScope = FlowScope<typeof engine, OrderParams, OrderState>;

// ── Stubs ───────────────────────────────────────────────────────────

interface Transaction {
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

async function beginTransaction(): Promise<Transaction> {
    return {
        async commit() {},
        async rollback() {},
    };
}

// ── Universal flow middleware (works in any flow) ────────────────────

const withTransaction: Middleware<FlowContext> = async (context, next) => {
    const transaction = await beginTransaction();
    context.log.info("transaction started");
    try {
        await next();
        await transaction.commit();
        context.log.info("transaction committed");
    } catch (error) {
        await transaction.rollback();
        context.log.info("transaction rolled back");
        throw error;
    }
};

const flowTiming: Middleware<FlowContext> = async (context, next) => {
    const start = Date.now();
    await next();
    context.log.info(`flow completed in ${Date.now() - start}ms`);
};

let featureEnabled = true;

const featureFlag: Middleware<FlowContext> = async (context, next) => {
    if (!featureEnabled) {
        context.log.info(`flow "${context.flowName}" disabled by feature flag — skipping`);
        return; // short-circuit: does not call next()
    }
    await next();
};

// ── Universal task middleware (works in any task) ────────────────────

const taskTiming: Middleware<TaskContext> = async (context, next) => {
    const start = Date.now();
    await next();
    context.log.info(`task "${context.nodeName}" attempt ${context.attempt}: ${Date.now() - start}ms`);
};

const retryLogger: Middleware<TaskContext> = async (context, next) => {
    if (context.attempt > 1) {
        context.log.warn(`retrying "${context.nodeName}" — attempt ${context.attempt}`);
    }
    await next();
};

// ── Scope-typed flow middleware (typed access to params/state) ───────

const orderAuditor: Middleware<FlowContext<OrderScope>> = async (context, next) => {
    context.log.info(`audit start: order ${context.params.orderId}`);
    await next();
    context.log.info(
        `audit end: order ${context.params.orderId} (charged=${context.state.get("charged")})`,
    );
};

// ── Scope-typed task middleware (typed access to state) ──────────────

const skipIfCharged: Middleware<TaskContext<OrderScope>> = async (context, next) => {
    if (context.state.get("charged")) {
        context.log.info(`skipping "${context.nodeName}" — order already charged`);
        return;
    }
    await next();
};

// ── Flow with middleware + retry ────────────────────────────────────

let failOnce = true;

engine.flow<OrderScope>({
    name: "order-pipeline",
    middleware: [featureFlag, withTransaction, flowTiming, orderAuditor],

    state: (params) => ({
        charged: false,
        orderId: params.orderId,
        validated: false,
    }),

    nodes: ({ task }) => [
        task({
            name: "validate-order",
            middleware: [taskTiming],
            handler: async (context) => {
                await delay(10);
                context.state.set("validated", true);
            },
        }),

        task({
            name: "charge-payment",
            middleware: [taskTiming, retryLogger, skipIfCharged],
            retry: {
                attempts: 3,
                backoff: "exponential",
                delayMs: 50,
                factor: 2,
                jitter: true,
                maxDelayMs: 500,
                retryOn: (error) => error instanceof Error && error.message.includes("timeout"),
            },
            handler: async (context) => {
                await delay(10);
                if (failOnce) {
                    failOnce = false;
                    throw new Error("payment gateway timeout");
                }
                context.state.set("charged", true);
            },
        }),

        // onError:"skip" — this task fails but does NOT fail the flow
        task({
            name: "send-receipt",
            middleware: [taskTiming],
            onError: "skip",
            retry: { attempts: 2, backoff: "constant", delayMs: 20 },
            handler: async () => {
                throw new Error("email service unavailable");
            },
        }),

        task({
            name: "confirm",
            middleware: [taskTiming],
            handler: (context) => {
                context.log.info(`order ${context.state.get("orderId")} confirmed`);
            },
        }),
    ],
});

// ── Run 1: feature enabled → full execution with retry ──────────────

title("Run 1 · Feature enabled (retry + onError:skip)");

const result1 = await engine.run("order-pipeline", { orderId: "ORD-001" });
log("\nFinal state:", result1.state);
log(
    `Tasks: ${result1.tasks.map((result) => `${result.nodeName}(${result.status}, ${result.attempts} attempts)`).join(", ")}`,
);

// ── Run 2: feature disabled → short-circuit by flow middleware ───────

title("Run 2 · Feature disabled (short-circuit)");

featureEnabled = false;
const result2 = await engine.run("order-pipeline", { orderId: "ORD-002" });
log("\nFinal state:", result2.state);
log(`Duration: ${result2.duration}ms`);
