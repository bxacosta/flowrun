/**
 * 07-cancellation.ts — Cancellation, timeouts, AbortSignal
 *
 * Covers:
 *  - createBrowserEngine({ defaultTimeout, defaultNavigationTimeout }) —
 *    applied to every page (including those opened by browser.newPage /
 *    browser.newSession unless overridden).
 *  - cancelStrategy:
 *      "close-context" (default) — on AbortSignal, the context owning
 *        the run's session/page is closed. Pending Playwright operations
 *        reject promptly.
 *      "none" — engine does not close anything; cancellation is purely
 *        cooperative via context.signal.
 *  - handle.cancel(reason) — turns the run into a CancelledFlowResult.
 *  - context.signal — AbortSignal honoured cooperatively by user code.
 *  - NavigationError — typed error produced by context.navigate() on
 *    timeout, network failure, or non-2xx status when configured to fail.
 */

import { browser, createBrowserEngine, NavigationError } from "@flowrun/browser";
import { BASE_URL, provider, selectors, storage } from "./shared/env.ts";
import { log, title } from "./shared/helpers.ts";

// ── Demo 1: defaultNavigationTimeout produces NavigationError ───────

title("1 - defaultNavigationTimeout: NavigationError on slow URLs");
const tightEngine = createBrowserEngine({
    provider,
    selectors,
    storage,
    defaultNavigationTimeout: 500,
});

const slowFlow = browser.flow("slow-nav").nodes(({ task }) => [
    task({
        name: "visit-slow-page",
        run: async (context) => {
            try {
                await context.navigate(`${BASE_URL}/slow?delay=5000`);
            } catch (error) {
                if (error instanceof NavigationError) {
                    context.log.warn(`navigation aborted: ${error.message}`);
                    return;
                }
                throw error;
            }
        },
    }),
]);
const r1 = await tightEngine.run(slowFlow);
log(`status: ${r1.status}`);

// ── Demo 2: handle.cancel() + close-context strategy ────────────────

title("2 - handle.cancel() with cancelStrategy: 'close-context'");
const engine = createBrowserEngine({
    provider,
    selectors,
    storage,
    cancelStrategy: "close-context",
    defaultTimeout: 30_000,
});

const longFlow = browser.flow("long-running").nodes(({ task }) => [
    task({
        name: "kick-off-report",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/dashboard/reports`);
            await context.page.click("[data-testid='report-generate']");
            // Wait long enough that we know cancellation interrupted us.
            await context.page.waitForSelector("[data-testid='report-download']", {
                timeout: 30_000,
            });
        },
    }),
]);

const handle = await engine.start(longFlow);
setTimeout(() => {
    handle.cancel("user pressed cancel");
}, 1500);
const r2 = await handle.join();
log(`status: ${r2.status}`);
if (r2.status === "cancelled") {
    log(`reason: ${r2.reason}`);
}

// ── Demo 3: cooperative cancellation via context.signal ─────────────

title("3 - cooperative cancellation via context.signal");
const coopFlow = browser
    .flow("coop-signal")
    .state({ stepsExecuted: 0 })
    .nodes(({ task }) => [
        task({
            name: "respect-signal",
            run: async (context) => {
                for (let index = 0; index < 20; index++) {
                    // Throws AbortError if cancelled — flow result becomes "cancelled".
                    context.signal.throwIfAborted();
                    await new Promise((resolve) => setTimeout(resolve, 150));
                    context.state.set("stepsExecuted", index + 1);
                }
            },
        }),
    ]);

const handle3 = await engine.start(coopFlow);
setTimeout(() => handle3.cancel("budget exhausted"), 700);
const r3 = await handle3.join();
log(`status: ${r3.status}, steps executed: ${r3.state.stepsExecuted}`);

// ── Demo 4: cancelStrategy: "none" — purely cooperative ─────────────

title("4 - cancelStrategy: 'none' (no auto-close, signal only)");
const looseEngine = createBrowserEngine({
    provider,
    selectors,
    storage,
    cancelStrategy: "none",
});

const looseFlow = browser.flow("loose").nodes(({ task }) => [
    task({
        name: "navigate-then-loop",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/`);
            // With "none", the page stays alive on cancel. The task must
            // honour context.signal itself or the run hangs.
            for (let index = 0; index < 10; index++) {
                context.signal.throwIfAborted();
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        },
    }),
]);

const handle4 = await looseEngine.start(looseFlow);
setTimeout(() => handle4.cancel(), 400);
const r4 = await handle4.join();
log(`status: ${r4.status}`);

await provider.dispose();
