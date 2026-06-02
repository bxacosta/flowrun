/**
 * 01-basics.ts — Fundamentals
 *
 * Covers:
 *  - flow(name) builder: chainable .params / .state / .nodes
 *  - createEngine(), engine.run(flow), engine.register(flow), engine.getFlow(name), engine.flows()
 *  - typed params and state propagating to handler contexts
 *  - the base context fields and the state store API (get, set, patch, has, snapshot)
 *  - FlowResult discrimination (success, failed, cancelled) and its full anatomy
 *  - shape<TShape>() for reusable typed node and flow definitions
 */

import { createEngine, flow, shape } from "@flowrun/core";
import { log, title } from "./shared/helpers.ts";

// The engine hosts the event bus, request manager and flow registry. One per app.
const engine = createEngine();

// ─────────────────────────────────────────────────────────────────────
// Flow 1: The simplest flow: no params, no state
// ─────────────────────────────────────────────────────────────────────

const healthCheck = flow("health-check").nodes(({ task }) => [
    task({
        name: "ping",
        run: (context) => {
            // Every context (flow, container, task) carries the same base fields:
            //   context.params - readonly, typed run input
            //   context.state - the typed state store
            //   context.signal - AbortSignal for cooperative cancellation
            //   context.emit - publishes an event
            //   context.request - opens a request
            //   context.log - scoped structured logger
            context.log.info("system is healthy", {
                flowName: context.flowName, // the flow's name
                runId: context.runId, // unique per run()/start()
            });
        },
    }),
]);

title("1 - No params, no state");
const healthResult = await engine.run(healthCheck);
log(`status: ${healthResult.status}`);

// ─────────────────────────────────────────────────────────────────────
// Flow 2: Typed params
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

title("2 - Typed params");
const notifyResult = await engine.run(notify, { channel: "#alerts", message: "deploy complete" });
log(`status: ${notifyResult.status}`);

// ─────────────────────────────────────────────────────────────────────
// Flow 3: Params + state derived from params; the state store API
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
                context.state.set("status", "validated"); // set: overwrite one key
                context.log.info(`validated ${context.params.orderId}`);
            },
        }),
        task({
            name: "calculate-total",
            run: (context) => {
                context.state.patch({ status: "calculated", total: 49.99 }); // patch: many keys at once
            },
        }),
        task({
            name: "finalize",
            run: (context) => {
                if (context.state.has("total")) {
                    // has: was the key explicitly set?
                    context.state.set("status", "completed");
                }
                context.log.info("final snapshot", { state: context.state.snapshot() }); // snapshot: readonly copy
            },
        }),
    ]);

title("3 - Params + derived state (state store API)");
const orderResult = await engine.run(processOrder, { orderId: "ORD-001" });
if (orderResult.status === "success") {
    log("state:", orderResult.state);
}

// ─────────────────────────────────────────────────────────────────────
// Flow 4: Params inferred from the state callback
// ─────────────────────────────────────────────────────────────────────

const archiveOrder = flow("archive-order")
    .state((params: { orderId: string; reason: string }) => ({
        archivedAt: 0,
        archivedId: params.orderId,
        reason: params.reason,
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

title("4 - Params inferred from the state callback");
const archiveResult = await engine.run(archiveOrder, { orderId: "ORD-002", reason: "duplicate" });
if (archiveResult.status === "success") {
    log(`archived ${archiveResult.state.archivedId} at ${archiveResult.state.archivedAt}`);
}

// ─────────────────────────────────────────────────────────────────────
// Flow 5: Literal state (independent of params)
// ─────────────────────────────────────────────────────────────────────

const inspect = flow("inspect")
    .params<{ path: string }>()
    .state({ finalUrl: "", userAgent: "" })
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

title("5 - Params + literal state");
const inspectResult = await engine.run(inspect, { path: "/" });
if (inspectResult.status === "success") {
    log(`final url: ${inspectResult.state.finalUrl}`);
}

// ─────────────────────────────────────────────────────────────────────
// Flow 6: Failure: FlowResult discrimination
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

title("6 - Result discrimination (failed flow)");
// run() never throws: failures come back as a discriminated result.
const riskyResult = await engine.run(riskyFlow);
if (riskyResult.status === "failed") {
    log(`error: ${riskyResult.error.message}`);
    log(`state at failure: processed=${riskyResult.state.processed}`);
}

// ─────────────────────────────────────────────────────────────────────
// Flow 7: shape<TShape>(): reusable nodes typed against a shape
// ─────────────────────────────────────────────────────────────────────

interface ReportShape {
    params: { title: string };
    state: { generated: boolean };
}

const report = shape<ReportShape>();

const generateTask = report.task({
    name: "generate",
    run: (context) => {
        context.state.set("generated", true);
        context.log.info(`report "${context.params.title}" generated`);
    },
});

const reportFlow = report.flow("generate-report").state({ generated: false }).nodes([generateTask]);

title("7 - Reusable shaped definitions");
const reportResult = await engine.run(reportFlow, { title: "Monthly Sales" });
log(`status: ${reportResult.status}, generated=${reportResult.state.generated}`);

// ─────────────────────────────────────────────────────────────────────
// Flow 8: Anatomy of a FlowResult
// ─────────────────────────────────────────────────────────────────────

// Everything run() / handle.join() gives back:
//   status: "success" | "failed" | "cancelled" (the discriminant)
//   flowName: the flow's name
//   runId: unique id for this execution
//   durationMs: total wall-clock time
//   state: readonly final state snapshot
//   tasks: one TaskResult per leaf task that ran: { nodeName, path, status, attempts, durationMs, ignored, reason?, iteration?, error? }
//   error: present only when status === "failed"
//   reason: present only when status === "cancelled"

const orderSummary = flow("order-summary")
    .state({ items: 0, status: "open" })
    .nodes(({ task }) => [
        task({
            name: "load-items",
            run: (context) => {
                context.state.set("items", 3);
            },
        }),
        task({
            name: "bulk-discount",
            run: (context) => {
                if (context.state.get("items") < 5) {
                    context.skip("fewer than 5 items"); // appears as a skipped TaskResult with a reason
                }
            },
        }),
        task({
            name: "close",
            run: (context) => {
                context.state.set("status", "closed");
            },
        }),
    ]);

title("8 - Anatomy of a FlowResult");
const summary = await engine.run(orderSummary);
log(`status:     ${summary.status}`);
log(`flowName:   ${summary.flowName}`);
log(`runId:      ${summary.runId}`);
log(`durationMs: ${summary.durationMs}`);
log("state:     ", summary.state);
log("tasks:");
for (const taskResult of summary.tasks) {
    const reason = taskResult.reason ? ` reason="${taskResult.reason}"` : "";
    log(
        `  ${taskResult.path} -> ${taskResult.status} (attempts=${taskResult.attempts}, ${taskResult.durationMs}ms, ignored=${taskResult.ignored})${reason}`
    );
}
if (summary.status === "failed") {
    log(`error: ${summary.error.message}`);
}
if (summary.status === "cancelled") {
    log(`reason: ${summary.reason}`);
}

// ─────────────────────────────────────────────────────────────────────
// Flow 9: By-name dispatch: register + getFlow + flows()
// ─────────────────────────────────────────────────────────────────────
// engine.run(def) runs an ad-hoc definition. To dispatch by name later,
// register it first; getFlow(name) then looks it up (throws if missing).

title("9 - register + getFlow + flows()");
const registered = engine.register(healthCheck);
log(`registered: ${registered.name}`);
log("all registered flows:", engine.flows());
const byName = await engine.getFlow("health-check").run();
log(`run by name: ${byName.status}`);
