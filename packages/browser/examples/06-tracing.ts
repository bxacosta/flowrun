/**
 * 06-tracing.ts — Tracing extension lifecycle
 *
 * Covers:
 *  - browser.tracing({ mode, ... }) — opt-in extension that requires
 *    browser + storage at the type level. createEngine + .use(browser(...))
 *    + .use(browser.storage(...)) + .use(browser.tracing(...)).
 *  - TracingExtensionConfig.mode:
 *      "off"                — extension installed but inert.
 *      "on"                 — record every run, save the trace zip always.
 *      "on-failure"         — record every run, save only when the flow fails.
 *      "retain-on-failure"  — record always, save only on failure;
 *                              same observable as "on-failure" today.
 *  - TracingExtensionConfig.screenshots / snapshots / sources — Playwright passthrough.
 *  - TracingExtensionConfig.storageKey({ runId, flowName }) — custom key for the
 *    trace zip persisted via the storage extension's StorageProvider.
 *  - tracing:saved event with reason "always" | "on-failure" | "retained".
 */

import {
    type BrowserShape,
    createBrowserEngine,
    storage,
    type TracingExtensionConfig,
    tracing,
} from "@flowrun/browser";
import { flow } from "@flowrun/core";
import { BASE_URL, localBrowser, STORAGE_ROOT, storageProvider } from "./shared/env.ts";
import { log, title } from "./shared/helpers.ts";

// Helper: build an engine with browser + storage + tracing, plus a subscriber.
function makeEngine(trace: TracingExtensionConfig) {
    const engine = createBrowserEngine({ provider: localBrowser })
        .use(storage({ provider: storageProvider }))
        .use(tracing(trace));
    engine.bus.subscribe("tracing:saved", (envelope) => {
        log(
            `  [tracing-saved] key=${envelope.payload.key}  size=${envelope.payload.size}B  reason=${envelope.payload.reason}`
        );
    });
    return engine;
}

// Two fixture flows: one that succeeds, one that throws.

const okFlow = flow<BrowserShape>("trace-ok").nodes(({ task }) => [
    task({
        name: "visit-some-pages",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/`);
            await context.navigate(`${BASE_URL}/about`);
            await context.navigate(`${BASE_URL}/pricing`);
        },
    }),
]);

const failFlow = flow<BrowserShape>("trace-fail").nodes(({ task }) => [
    task({
        name: "visit-then-throw",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/`);
            throw new Error("intentional failure for tracing");
        },
    }),
]);

const sharedTraceOpts: Omit<TracingExtensionConfig, "mode"> = {
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

await localBrowser.dispose();
