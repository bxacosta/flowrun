/**
 * 01-basics.ts — Fundamentals
 *
 * Covers:
 *  - createEngine() and engine.flow()
 *  - Flow without params / with params / with params + state
 *  - context.state (get, set, patch, snapshot, has)
 *  - context.params, context.log
 *  - FlowResult discrimination (success, failed)
 *  - engine.run() (run by registered name)
 *  - engine.flows() (list registered flows)
 *  - Define API: defineTask() + defineFlow() as alternative to inline builder
 */

import { createEngine, defineFlow, defineTask } from "@flowrun/core"
import type { FlowScope } from "@flowrun/core"
import { subscriber } from "./shared/subscriber.ts";
import { log, title } from "./shared/helpers.ts";

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();
subscriber(engine.bus);

// ─────────────────────────────────────────────────────────────────────
// Flow 1: no params, no state — the simplest possible flow
// ─────────────────────────────────────────────────────────────────────

const healthCheck = engine.flow({
    name: "health-check",
    nodes: ({ task }) => [
        task({
            name: "ping",
            handler: (context) => {
                context.log.info("system is healthy");
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 2: typed params, no state
// ─────────────────────────────────────────────────────────────────────

const notify = engine.flow<{ channel: string; message: string }>({
    name: "notify",
    nodes: ({ task }) => [
        task({
            name: "send",
            handler: (context) => {
                context.log.info(`[${context.params.channel}] ${context.params.message}`);
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 3: params + state — demonstrates full state API
// ─────────────────────────────────────────────────────────────────────

const processOrder = engine.flow({
    name: "process-order",
    state: (params: { orderId: string }) => ({
        orderId: params.orderId,
        status: "pending" as string,
        total: 0,
    }),

    nodes: ({ task }) => [
        task({
            name: "validate",
            handler: (context) => {
                context.state.set("status", "validated");
                context.log.info(`validated ${context.params.orderId}`);
            },
        }),

        task({
            name: "calculate-total",
            handler: (context) => {
                // patch: update multiple state keys at once
                context.state.patch({ total: 49.99, status: "calculated" });
            },
        }),

        task({
            name: "finalize",
            handler: (context) => {
                // has: check if a key has been explicitly set
                if (context.state.has("total")) {
                    context.state.set("status", "completed");
                }

                // snapshot: get a readonly copy of the full state
                const snap = context.state.snapshot();
                context.log.info(`final state: ${JSON.stringify(snap)}`);
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 4: demonstrates failure → FlowResult discrimination
// ─────────────────────────────────────────────────────────────────────

const riskyFlow = engine.flow({
    name: "risky",
    state: () => ({ processed: false }),

    nodes: ({ task }) => [
        task({
            name: "process",
            handler: (context) => {
                context.state.set("processed", true);
            },
        }),

        task({
            name: "might-fail",
            handler: () => {
                throw new Error("unexpected error");
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 5: Define API — same flow expressed with standalone definitions
// ─────────────────────────────────────────────────────────────────────

type ReportScope = FlowScope<typeof engine, { title: string }, { generated: boolean }>;

const generateTask = defineTask<ReportScope>({
    name: "generate",
    handler: (context) => {
        context.state.set("generated", true);
        context.log.info(`report "${context.params.title}" generated`);
    },
});

const reportDefinition = defineFlow<ReportScope>({
    name: "generate-report",
    state: () => ({ generated: false }),
    nodes: [generateTask],
});

const reportFlow = engine.flow(reportDefinition);

// ── Run ─────────────────────────────────────────────────────────────

title("1 · No params, no state");

const healthResult = await healthCheck.run();
log(`Status: ${healthResult.status}`);

title("2 · Typed params, no state");

const notifyResult = await notify.run({ channel: "#alerts", message: "deploy complete" });
log(`Status: ${notifyResult.status}`);

title("3 · Params + state (full state API)");

const orderResult = await processOrder.run({ orderId: "ORD-001" });
if (orderResult.status === "success") {
    log("State:", orderResult.state);
    log(`Duration: ${orderResult.duration}ms`);
    log(`Tasks: ${orderResult.tasks.map((result) => `${result.nodeName}(${result.status})`).join(", ")}`);
}

title("4 · Result discrimination (failed flow)");

const riskyResult = await riskyFlow.run();
if (riskyResult.status === "failed") {
    log(`Error: ${riskyResult.error.message}`);
    log(`State at failure: processed=${riskyResult.state.processed}`);
    log(`Tasks: ${riskyResult.tasks.map((result) => `${result.nodeName}(${result.status})`).join(", ")}`);
}

title("5 · Define API (defineTask + defineFlow)");

const reportResult = await reportFlow.run({ title: "Monthly Sales" });
log(`Status: ${reportResult.status}, generated=${reportResult.state.generated}`);

title("6 · engine.run() and engine.flows()");

log("Registered flows:", engine.flows());

const runResult = await engine.run("health-check");
log(`Run by name: ${runResult.status}`);
