/**
 * 06-tracing.ts — TraceConfig modes and lifecycle
 *
 * Covers:
 *  - TraceConfig.mode:
 *      "off"                — tracing disabled (default).
 *      "on"                 — record every run, save the trace zip always.
 *      "on-failure"         — record every run, save only when the flow fails.
 *      "retain-on-failure"  — record every run, save only when the flow fails;
 *                              optimised for keeping the cost of the success
 *                              path low.
 *  - TraceConfig.screenshots / snapshots / sources — passthrough to Playwright.
 *  - TraceConfig.storageKey({ runId, flowName }) — custom key for the trace
 *    zip persisted via StorageProvider.save().
 *  - browser:tracing-saved event with reason "always" | "on-failure" | "retained".
 */

import { browser, createBrowserEngine, type TraceConfig } from "@flowrun/browser";
import { log, title } from "../core/shared/helpers.ts";
import { BASE_URL, provider, selectors, storage, STORAGE_ROOT } from "./shared/env.ts";

// Helper: build an engine with a given trace config and a subscriber.
function makeEngine(trace: TraceConfig) {
    const engine = createBrowserEngine({ provider, selectors, storage, trace });
    engine.bus.subscribe("browser:tracing-saved", (envelope) => {
        log(
            `  [tracing-saved] key=${envelope.payload.key}  size=${envelope.payload.size}B  reason=${envelope.payload.reason}`
        );
    });
    return engine;
}

// Two fixture flows: one that succeeds, one that throws.

const okFlow = browser.flow({
    name: "trace-ok",
    nodes: ({ task }) => [
        task({
            name: "visit-some-pages",
            run: async (context) => {
                await context.navigate(`${BASE_URL}/`);
                await context.navigate(`${BASE_URL}/about`);
                await context.navigate(`${BASE_URL}/pricing`);
            },
        }),
    ],
});

const failFlow = browser.flow({
    name: "trace-fail",
    nodes: ({ task }) => [
        task({
            name: "visit-then-throw",
            run: async (context) => {
                await context.navigate(`${BASE_URL}/`);
                throw new Error("intentional failure for tracing");
            },
        }),
    ],
});

const sharedTraceOpts: Omit<TraceConfig, "mode"> = {
    screenshots: true,
    snapshots: true,
    sources: false,
    storageKey: ({ runId, flowName }) => `06-tracing/${flowName}-${runId.slice(0, 8)}.zip`,
};

// ── Demo 1: mode "off" — no trace ever saved ────────────────────────

title("1 - mode: 'off'  (default; no tracing)");
const e1 = makeEngine({ mode: "off" });
await e1.run(okFlow);
log("(no tracing-saved event expected)");

// ── Demo 2: mode "on" — trace always saved ──────────────────────────

title("2 - mode: 'on'   (always save trace)");
const e2 = makeEngine({ mode: "on", ...sharedTraceOpts });
await e2.run(okFlow);

// ── Demo 3: mode "on-failure" — trace only on failure ───────────────

title("3 - mode: 'on-failure'  (save trace only when the flow fails)");
const e3 = makeEngine({ mode: "on-failure", ...sharedTraceOpts });
log("  success run:");
await e3.run(okFlow);
log("  (no tracing-saved expected on success)");
log("  failing run:");
await e3.run(failFlow);

// ── Demo 4: mode "retain-on-failure" ────────────────────────────────

title("4 - mode: 'retain-on-failure'  (record always, save only on failure)");
const e4 = makeEngine({ mode: "retain-on-failure", ...sharedTraceOpts });
await e4.run(failFlow);

log(`\nAll trace zips persisted under: ${STORAGE_ROOT}/06-tracing/`);

await provider.dispose();
