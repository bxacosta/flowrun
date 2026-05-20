/**
 * 01-basics.ts — Engine setup & provided context
 *
 * Covers:
 *  - createBrowserEngine(config) wiring (provider, selectors, storage)
 *  - browser.flow() — entry for browser flows (typed params/state)
 *  - BrowserProvidedContext keys exposed on every task context:
 *      context.page       (playwright Page)
 *      context.navigate   (ctx.navigate(url, options?) — emits events)
 *      context.selectors  (SelectorRegistry)
 *      context.storage    (StorageProvider)
 *      context.session    (BrowserSession = { context, page })
 *      context.provider   (BrowserProvider)
 *  - engine.run(flow, params?) / engine.register(flow) / engine.start(flow)
 *  - provider.dispose() — closes shared chromium process
 */

import { browser, createBrowserEngine } from "@flowrun/browser";
import { log, title } from "../core/shared/helpers.ts";
import { BASE_URL, provider, selectors, storage } from "./shared/env.ts";

// ── Engine ──────────────────────────────────────────────────────────

const engine = createBrowserEngine({
    provider,
    selectors,
    storage,
});

// ── Flow 1: simplest possible browser flow ──────────────────────────

const home = browser.flow({
    name: "home",
    nodes: ({ task }) => [
        task({
            name: "visit",
            run: async (context) => {
                await context.navigate(`${BASE_URL}/`);
                const pageTitle = await context.page.title();
                context.log.info(`landed on: ${pageTitle}`);
            },
        }),
    ],
});

// ── Flow 2: typed params + state, uses every provided context key ───

const inspect = browser.flow<{ path: string }>({
    name: "inspect",
    state: () => ({
        finalUrl: "",
        userAgent: "",
    }),
    nodes: ({ task }) => [
        task({
            name: "visit-and-record",
            run: async (context) => {
                // context.navigate -> tracked goto. Use context.page.goto for raw access.
                await context.navigate(`${BASE_URL}${context.params.path}`);

                // context.page is the underlying playwright Page (native API).
                const userAgent = await context.page.evaluate(() => navigator.userAgent);

                // context.session.context exposes the BrowserContext (cookies, storage).
                const cookies = await context.session.context.cookies();
                context.log.info(`cookies in context: ${cookies.length}`);

                // context.provider is the same BrowserProvider passed to the engine.
                context.log.info(`provider class: ${context.provider.constructor.name}`);

                context.state.patch({
                    finalUrl: context.page.url(),
                    userAgent,
                });
            },
        }),
        task({
            name: "use-selectors",
            run: async (context) => {
                // context.selectors -> registry passed at engine construction.
                const titleLocator = await context.selectors.resolve("pageTitle", context.page);
                const titleText = await titleLocator.textContent();
                context.log.info(`page-title text: ${titleText ?? "(not found)"}`);
            },
        }),
        task({
            name: "use-storage",
            run: async (context) => {
                // context.storage -> StorageProvider passed at engine construction.
                const screenshot = await context.page.screenshot();
                await context.storage.save("01-basics/home.png", new Uint8Array(screenshot));
                context.log.info("screenshot persisted to storage");
            },
        }),
    ],
});

// ── Run ─────────────────────────────────────────────────────────────

title("1 - simplest flow (just navigate)");
const r1 = await engine.run(home);
log(`status: ${r1.status}, duration: ${r1.duration}ms`);

title("2 - typed params + every provided context key");
const r2 = await engine.run(inspect, { path: "/" });
if (r2.status === "success") {
    log(`final url: ${r2.state.finalUrl}`);
    log(`user agent: ${r2.state.userAgent.slice(0, 80)}...`);
}

title("3 - engine.register() + by-name lookup");
const registered = engine.register(home);
log(`registered: ${registered.name}, all flows: ${engine.flows().join(", ")}`);
const r3 = await engine.flow("home").run({});
log(`run by name: ${r3.status}`);

// Shared chromium process is reused across flows; dispose at the very end.
await provider.dispose();
