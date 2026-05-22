/**
 * 04-isolation.ts — Per-iteration / per-branch isolation
 *
 * Covers:
 *  - browser.newPage(options?) — opens a new tab in the SAME BrowserContext.
 *    Cookies and storage are shared with the parent session.
 *  - browser.newSession(options?) — opens a FRESH BrowserContext.
 *    Independent cookies / storageState — useful for multi-account work.
 *  - Both resources expose { page, navigate, session } on the child context
 *    and close automatically on cleanup.
 *  - Usage with `every` (per-iteration) and `parallel` (per-branch).
 *  - cancelStrategy: "close-context" closes the resource on AbortSignal.
 */

import { browser, createBrowserEngine } from "@flowrun/browser";
import { log, title } from "../core/shared/helpers.ts";
import { BASE_URL, provider, selectors, storage } from "./shared/env.ts";

const engine = createBrowserEngine({ provider, selectors, storage });

const DASHBOARD_URL_PATTERN = /\/dashboard/;
const LOGIN_CODE_URL_PATTERN = /\/login\/code/;

// ── Flow 1: every() + browser.newPage() — one tab per iteration ─────

const months = ["2024-01", "2024-02", "2024-03", "2024-04"];

const scrapeMonths = browser
    .flow("scrape-months")
    .state({ results: [] as { month: string; url: string }[] })
    .nodes(({ every }) => [
        every({
            name: "by-month",
            items: () => months,
            concurrency: 2,
            merge: "append",

            // resource opens a fresh tab per iteration and closes it on
            // cleanup. context.page / context.navigate / context.session
            // in the child tasks point at the new tab, not at the parent.
            resource: browser.newPage(),

            nodes: ({ task }) => [
                task({
                    name: "visit",
                    run: async (context) => {
                        await context.navigate(`${BASE_URL}/dashboard/invoices?search=${context.iteration.item}`);
                        context.state.set("results", [{ month: context.iteration.item, url: context.page.url() }]);
                    },
                }),
            ],
        }),
    ]);

title("1 - every() + browser.newPage() (per-iteration tabs)");
const r1 = await engine.run(scrapeMonths);
log(`status: ${r1.status}`);
for (const entry of r1.state.results) {
    log(`  ${entry.month} -> ${entry.url}`);
}

// ── Flow 2: parallel() + browser.newPage() — one tab per branch ─────

const splitWork = browser
    .flow("split-work")
    .state({ invoicesUrl: "", reportsUrl: "" })
    .nodes(({ parallel }) => [
        parallel({
            name: "fan-out-tabs",
            merge: "overwrite",
            resource: browser.newPage({ defaultNavigationTimeout: 10_000 }),
            nodes: ({ task }) => [
                task({
                    name: "tab-invoices",
                    run: async (context) => {
                        await context.navigate(`${BASE_URL}/dashboard/invoices`);
                        context.state.set("invoicesUrl", context.page.url());
                    },
                }),
                task({
                    name: "tab-reports",
                    run: async (context) => {
                        await context.navigate(`${BASE_URL}/dashboard/reports`);
                        context.state.set("reportsUrl", context.page.url());
                    },
                }),
            ],
        }),
    ]);

title("2 - parallel() + browser.newPage() (per-branch tabs, same context)");
const r2 = await engine.run(splitWork);
log(`status: ${r2.status}`);
log(`invoices tab: ${r2.state.invoicesUrl}`);
log(`reports tab: ${r2.state.reportsUrl}`);

// ── Flow 3: parallel() + browser.newSession() — one context per branch ─

const multiAccount = browser
    .flow("multi-account")
    .state({ acmeFinalUrl: "", twofaFinalUrl: "" })
    .nodes(({ parallel }) => [
        parallel({
            name: "per-account",
            merge: "overwrite",

            // Each branch gets a brand-new BrowserContext with its own
            // cookies, localStorage, and storageState. The two branches
            // cannot interfere with each other's session.
            resource: browser.newSession({
                contextOptions: {
                    viewport: { width: 1280, height: 800 },
                },
            }),

            nodes: ({ task }) => [
                task({
                    name: "acme-login",
                    run: async (context) => {
                        await context.navigate(`${BASE_URL}/login`);
                        const user = await context.selectors.resolve("loginUser", context.page);
                        const pass = await context.selectors.resolve("loginPass", context.page);
                        const submit = await context.selectors.resolve("loginSubmit", context.page);
                        await user.fill("acme");
                        await pass.fill("acme");
                        await submit.click();
                        await context.page.waitForURL(DASHBOARD_URL_PATTERN);
                        context.state.set("acmeFinalUrl", context.page.url());
                    },
                }),
                task({
                    name: "twofa-login-stops-before-code",
                    run: async (context) => {
                        await context.navigate(`${BASE_URL}/login`);
                        const user = await context.selectors.resolve("loginUser", context.page);
                        const pass = await context.selectors.resolve("loginPass", context.page);
                        const submit = await context.selectors.resolve("loginSubmit", context.page);
                        await user.fill("2fa");
                        await pass.fill("2fa");
                        await submit.click();
                        await context.page.waitForURL(LOGIN_CODE_URL_PATTERN);
                        context.state.set("twofaFinalUrl", context.page.url());
                    },
                }),
            ],
        }),
    ]);

title("3 - parallel() + browser.newSession() (per-branch contexts)");
const r3 = await engine.run(multiAccount);
log(`status: ${r3.status}`);
log(`acme final url: ${r3.state.acmeFinalUrl}`);
log(`2fa final url:  ${r3.state.twofaFinalUrl}`);

await provider.dispose();
