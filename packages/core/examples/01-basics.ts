/**
 * 01-basics.ts — Fundamentals
 *
 * Covers:
 *  - flow(name) builder: chainable .params / .state / .nodes
 *  - createEngine(), engine.run(flow), engine.register(flow), engine.getFlow(name)
 *  - typed params and state propagating to handler contexts
 *  - context.state (get, set, patch, snapshot, has)
 *  - context.params, context.log
 *  - FlowResult discrimination (success, failed, cancelled)
 *  - engine.flows() (list registered flows)
 *  - shape<TShape>() for reusable typed nodes shared across files
 */

import { createEngine, flow, type Node, shape } from "@flowrun/core";
import { log, title } from "./shared/helpers.ts";

// ─────────────────────────────────────────────────────────────────────
// Flow 1: no params, no state — the simplest possible flow
// ─────────────────────────────────────────────────────────────────────
const healthCheck = flow("health-check").nodes(({ task }) => [
    task({
        name: "ping",
        run: (context) => {
            context.log.info("system is healthy");
        },
    }),
]);

// ─────────────────────────────────────────────────────────────────────
// Flow 2: typed params, no state
// ─────────────────────────────────────────────────────────────────────
const notify = flow("notify")
    .params<{ channel: string; message: string }>()
    .nodes(({ task }) => [
        task({
            name: "send",
            run: (context) => {
                context.log.info(`[${context.params.channel}] ${context.params.message}`);
            },
        }),
    ]);

// ─────────────────────────────────────────────────────────────────────
// Flow 3: params + state derived from params (callback form)
// ─────────────────────────────────────────────────────────────────────
const processOrder = flow("process-order")
    .params<{ orderId: string }>()
    .state((params) => ({
        orderId: params.orderId,
        status: "pending",
        total: 0,
    }))
    .nodes(({ task }) => [
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
    ]);

// ─────────────────────────────────────────────────────────────────────
// Flow 4: params inferred from the state callback
// ─────────────────────────────────────────────────────────────────────

const archiveOrder = flow("archive-order")
    .state((params: { orderId: string; reason: string }) => ({
        archivedId: params.orderId,
        reason: params.reason,
        archivedAt: 0,
    }))
    .nodes(({ task }) => [
        task({
            name: "archive",
            run: (context) => {
                context.state.set("archivedAt", Date.now());
                context.log.info(`archived ${context.params.orderId} (${context.params.reason})`);
            },
        }),
    ]);

// ─────────────────────────────────────────────────────────────────────
// Flow 5: params + literal state (state independent of params)
// ─────────────────────────────────────────────────────────────────────

const inspect = flow("inspect")
    .params<{ path: string }>()
    .state({
        finalUrl: "",
        userAgent: "",
    })
    .nodes(({ task }) => [
        task({
            name: "record",
            run: (context) => {
                context.state.patch({
                    finalUrl: `https://example.com${context.params.path}`,
                    userAgent: "Demo/1.0",
                });
            },
        }),
    ]);

// ─────────────────────────────────────────────────────────────────────
// Flow 6: failure handling — FlowResult discrimination
// ─────────────────────────────────────────────────────────────────────

const riskyFlow = flow("risky")
    .state({ processed: false })
    .nodes(({ task }) => [
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
    ]);

// ─────────────────────────────────────────────────────────────────────
// Flow 7: shape<TShape>() — reusable nodes typed against a shape
// ─────────────────────────────────────────────────────────────────────

interface ReportShape {
    params: { title: string };
    state: { generated: boolean };
}

const report = shape<ReportShape>();

const generateTask: Node<ReportShape> = report.task({
    name: "generate",
    run: (context) => {
        context.state.set("generated", true);
        context.log.info(`report "${context.params.title}" generated`);
    },
});

const reportFlow = report.flow("generate-report").state({ generated: false }).nodes([generateTask]);

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();

// ── Run ─────────────────────────────────────────────────────────────
// engine.run(def, params?) is the typed shortcut for one-shot execution.
// engine.register(def) returns a typed Flow handle and adds it to the registry.
// engine.getFlow(name) does dynamic by-name lookup (throws FlowNotRegisteredError if missing).

title("1 - No params, no state");
const healthResult = await engine.run(healthCheck);
log(`Status: ${healthResult.status}`);

title("2 - Typed params, no state");
const notifyResult = await engine.run(notify, { channel: "#alerts", message: "deploy complete" });
log(`Status: ${notifyResult.status}`);

title("3 - Params + state derived from params (full state API)");
const orderResult = await engine.run(processOrder, { orderId: "ORD-001" });
if (orderResult.status === "success") {
    log("State:", orderResult.state);
    log(`Duration: ${orderResult.durationMs}ms`);
    log(`Tasks: ${orderResult.tasks.map((result) => `${result.nodeName}(${result.status})`).join(", ")}`);
}

title("4 - Params inferred from the state callback");
const archiveResult = await engine.run(archiveOrder, { orderId: "ORD-002", reason: "duplicate" });
if (archiveResult.status === "success") {
    log(`archived ${archiveResult.state.archivedId} at ${archiveResult.state.archivedAt}`);
}

title("5 - Params + literal state (state independent of params)");
const inspectResult = await engine.run(inspect, { path: "/" });
if (inspectResult.status === "success") {
    log(`final url: ${inspectResult.state.finalUrl}`);
    log(`user agent: ${inspectResult.state.userAgent}`);
}

title("6 - Result discrimination (failed flow)");
const riskyResult = await engine.run(riskyFlow);
if (riskyResult.status === "failed") {
    log(`Error: ${riskyResult.error.message}`);
    log(`State at failure: processed=${riskyResult.state.processed}`);
}

title("7 - Reusable shaped definitions");
const reportResult = await engine.run(reportFlow, { title: "Monthly Sales" });
log(`Status: ${reportResult.status}, generated=${reportResult.state.generated}`);

title("8 - engine.register() + engine.getFlow(name) for by-name dispatch");
const registeredHealth = engine.register(healthCheck);
log(`Registered: ${registeredHealth.name}`);
log("All registered flows:", engine.flows());
const runByName = await engine.getFlow("health-check").run();
log(`Run by name: ${runByName.status}`);
