/**
 * 01-basics.ts — Fundamentals
 *
 * Covers:
 *  - define.flow() for portable flow definitions
 *  - createEngine(), engine.run(flow), engine.register(flow), engine.flow(name)
 *  - typed params / state from inline state factories
 *  - context.state (get, set, patch, snapshot, has)
 *  - context.params, context.log
 *  - FlowResult discrimination (success, failed)
 *  - engine.flows() (list registered flows)
 *  - define.scope() for reusable typed nodes
 */

import { createEngine, define, type Node, type ScopeFromContract } from "@flowrun/core";
import { log, title } from "./shared/helpers.ts";

// ─────────────────────────────────────────────────────────────────────
// Flow 1: no params, no state — the simplest possible flow
// ─────────────────────────────────────────────────────────────────────

const healthCheck = define.flow({
    name: "health-check",
    nodes: ({ task }) => [
        task({
            name: "ping",
            run: (context) => {
                context.log.info("system is healthy");
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 2: typed params, no state
// ─────────────────────────────────────────────────────────────────────

const notify = define.flow<{ channel: string; message: string }>({
    name: "notify",
    nodes: ({ task }) => [
        task({
            name: "send",
            run: (context) => {
                context.log.info(`[${context.params.channel}] ${context.params.message}`);
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 3: params + state — demonstrates full state API
// ─────────────────────────────────────────────────────────────────────

const processOrder = define.flow({
    name: "process-order",
    state: (params: { orderId: string }) => ({
        orderId: params.orderId,
        status: "pending" as string,
        total: 0,
    }),
    nodes: ({ task }) => [
        task({
            name: "validate",
            run: (context) => {
                context.state.set("status", "validated");
                context.log.info(`validated ${context.params.orderId}`);
            },
        }),
        task({
            name: "calculate-total",
            run: (context) => {
                // patch: update multiple state keys at once
                context.state.patch({ total: 49.99, status: "calculated" });
            },
        }),
        task({
            name: "finalize",
            run: (context) => {
                // has: check if a key has been explicitly set
                if (context.state.has("total")) {
                    context.state.set("status", "completed");
                }

                // snapshot: get a readonly copy of the full state
                context.log.info(`final state: ${JSON.stringify(context.state.snapshot())}`);
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 4: demonstrates failure — FlowResult discrimination
// ─────────────────────────────────────────────────────────────────────

const riskyFlow = define.flow({
    name: "risky",
    state: () => ({ processed: false }),
    nodes: ({ task }) => [
        task({
            name: "process",
            run: (context) => {
                context.state.set("processed", true);
            },
        }),
        task({
            name: "might-fail",
            run: () => {
                throw new Error("unexpected error");
            },
        }),
    ],
});

// ─────────────────────────────────────────────────────────────────────
// Flow 5: define.scope() — reusable nodes typed against a contract
// ─────────────────────────────────────────────────────────────────────

interface ReportContract {
    params: { title: string };
    state: { generated: boolean };
}

type ReportScope = ScopeFromContract<ReportContract>;

const report = define.scope<ReportContract>();

// Tasks defined under a scope can be reused across flows that share the contract.
const generateTask: Node<ReportScope> = report.task({
    name: "generate",
    run: (context) => {
        context.state.set("generated", true);
        context.log.info(`report "${context.params.title}" generated`);
    },
});

const reportFlow = report.flow({
    name: "generate-report",
    state: () => ({ generated: false }),
    nodes: [generateTask],
});

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();

// ── Run ─────────────────────────────────────────────────────────────
// engine.run(def, params?) is the typed shortcut for one-shot execution.
// engine.register(def) returns a typed Flow handle and adds it to the registry.
// engine.flow(name) does dynamic by-name lookup (throws FlowNotRegisteredError if missing).

title("1 - No params, no state");
const healthResult = await engine.run(healthCheck);
log(`Status: ${healthResult.status}`);

title("2 - Typed params, no state");
const notifyResult = await engine.run(notify, { channel: "#alerts", message: "deploy complete" });
log(`Status: ${notifyResult.status}`);

title("3 - Params + state (full state API)");
const orderResult = await engine.run(processOrder, { orderId: "ORD-001" });
if (orderResult.status === "success") {
    log("State:", orderResult.state);
    log(`Duration: ${orderResult.duration}ms`);
    log(`Tasks: ${orderResult.tasks.map((result) => `${result.nodeName}(${result.status})`).join(", ")}`);
}

title("4 - Result discrimination (failed flow)");
const riskyResult = await engine.run(riskyFlow);
if (riskyResult.status === "failed") {
    log(`Error: ${riskyResult.error.message}`);
    log(`State at failure: processed=${riskyResult.state.processed}`);
}

title("5 - Reusable scoped definitions");
const reportResult = await engine.run(reportFlow, { title: "Monthly Sales" });
log(`Status: ${reportResult.status}, generated=${reportResult.state.generated}`);

title("6 - engine.register() + engine.flow(name) for by-name dispatch");
const registeredHealth = engine.register(healthCheck);
log(`Registered: ${registeredHealth.name}`);
log("All registered flows:", engine.flows());
const runByName = await engine.flow("health-check").run({});
log(`Run by name: ${runByName.status}`);
