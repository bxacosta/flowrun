/**
 * 05-events.ts — Bus events across browser/selectors/storage extensions
 *
 * Covers:
 *  - engine.bus subscriptions for every browser:* topic:
 *      browser:opened         (session opened at run start)
 *      browser:closed         (session closed at cleanup)
 *      browser:navigated      (every successful navigate())
 *      browser:page-opened    (resource.newPage resource opened a tab)
 *      browser:page-closed    (resource.newPage resource closed a tab)
 *      browser:session-opened (resource.newSession resource opened a context)
 *      browser:session-closed (resource.newSession resource closed a context)
 *      browser:page-error     (uncaught error in the page)
 *      browser:console-error  (console.error from the page)
 *  - And cross-extension topics:
 *      storage:saved          (StorageProvider.save/saveStream completed)
 *  - Wildcard subscription (browser:**) and filter / once options
 *  - Extension flags that gate emission:
 *      browser({ emitPageErrors, emitConsoleErrors, emitNavigateEvent })
 *      storage({ emitEvent })
 */

import { type BrowserShape, createBrowserEngine, resource, storage, type WithStorage } from "@flowrun/browser";
import { type Envelope, flow } from "@flowrun/core";
import { BASE_URL, localBrowser, storageProvider } from "./shared/env.ts";
import { log, title } from "./shared/helpers.ts";

const engine = createBrowserEngine({
    provider: localBrowser,
    // Defaults are all true. Setting them here makes the contract explicit.
    emitPageErrors: true,
    emitConsoleErrors: true,
    emitNavigateEvent: true,
}).use(storage({ provider: storageProvider, emitEvent: true }));

type AppShape = WithStorage<BrowserShape>;

// ── Wildcard subscription: every browser:* topic ────────────────────

const seen: string[] = [];
const wildcardSub = engine.bus.match("browser:**", (envelope: Envelope) => {
    seen.push(envelope.topic);
});

// ── Typed per-topic subscriptions ───────────────────────────────────

engine.bus.subscribe("browser:opened", (envelope) => {
    log(`  [opened]   correlationId=${envelope.correlationId ?? "-"}`);
});

engine.bus.subscribe("browser:navigated", (envelope) => {
    log(`  [navigated] ${envelope.payload.url} (${envelope.payload.durationMs}ms)`);
});

engine.bus.subscribe("browser:page-error", (envelope) => {
    log(`  [page-error]    ${envelope.payload.message}`);
});

engine.bus.subscribe("browser:console-error", (envelope) => {
    const loc = envelope.payload.location
        ? ` @ ${envelope.payload.location.url}:${envelope.payload.location.lineNumber}`
        : "";
    log(`  [console-error] ${envelope.payload.text}${loc}`);
});

engine.bus.subscribe("storage:saved", (envelope) => {
    log(`  [storage-saved] ${envelope.payload.key} (${envelope.payload.size}B)`);
});

engine.bus.subscribe("browser:page-opened", (envelope) => {
    const where = envelope.payload.branch
        ? `branch=${envelope.payload.branch}`
        : `iteration=${envelope.payload.iteration}`;
    log(`  [page-opened]  ${where}`);
});

engine.bus.subscribe("browser:page-closed", (envelope) => {
    const where = envelope.payload.branch
        ? `branch=${envelope.payload.branch}`
        : `iteration=${envelope.payload.iteration}`;
    log(`  [page-closed]  ${where}`);
});

// once: auto-unsubscribe after the first match
engine.bus.subscribe("browser:closed", () => log("  [closed]   (run finished)"), { once: true });

// ── Flow 1: trigger navigated, page-error, console-error, storage-saved ─

const observability = flow<AppShape>("observability").nodes(({ task }) => [
    task({
        name: "land",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/`);
        },
    }),
    task({
        name: "trigger-page-error",
        run: async (context) => {
            // The fixture page throws an uncaught error in useEffect on mount.
            // browser:page-error fires for the runtime exception. We wait a
            // moment after the load event so React has time to mount and run
            // the effect before the flow moves on.
            await context.navigate(`${BASE_URL}/test/page-error`);
            await context.page.waitForTimeout(300);
        },
    }),
    task({
        name: "trigger-console-error",
        run: async (context) => {
            // The fixture page calls console.error() on mount; same timing
            // caveat as trigger-page-error above.
            await context.navigate(`${BASE_URL}/test/console-error`);
            await context.page.waitForTimeout(300);
        },
    }),
    task({
        name: "trigger-storage-event",
        run: async (context) => {
            // Any save / saveStream through context.storage emits
            // browser:storage-saved (gated by emitStorageEvent).
            await context.storage.save("05-events/probe.txt", new TextEncoder().encode("hello"));
        },
    }),
]);

title("1 - Trigger every event-emitting code path");
const r1 = await engine.run(observability);
log(`status: ${r1.status}`);

// ── Flow 2: per-tab events via resource.newPage() ────────────────────

const tabsFlow = flow<BrowserShape>("tabs-events").nodes(({ parallel }) => [
    parallel({
        name: "two-tabs",
        merge: "overwrite",
        resource: resource.newPage(),
        nodes: ({ task }) => [
            task({
                name: "tab-a",
                run: async (context) => {
                    await context.navigate(`${BASE_URL}/about`);
                },
            }),
            task({
                name: "tab-b",
                run: async (context) => {
                    await context.navigate(`${BASE_URL}/pricing`);
                },
            }),
        ],
    }),
]);

title("2 - page-opened / page-closed (from resource.newPage)");
const r2 = await engine.run(tabsFlow);
log(`status: ${r2.status}`);

// ── Topics observed via wildcard ────────────────────────────────────

wildcardSub.unsubscribe();
const unique = [...new Set(seen)].sort();
log(`\nDistinct browser:* topics observed (${unique.length}):`);
for (const topic of unique) {
    log(`  ${topic}`);
}

await localBrowser.dispose();
