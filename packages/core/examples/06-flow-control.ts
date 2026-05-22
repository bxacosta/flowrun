/**
 * 06-flow-control.ts — Flow Handle & Resource Isolation
 *
 * Covers:
 *  - engine.start(flow) -> FlowHandle
 *  - handle.join(), handle.status()
 *  - handle.cancel(reason) -> CancelledFlowResult
 *  - handle.pause() / handle.resume()
 *  - context.signal (cooperative cancellation with AbortSignal)
 *  - resource in every (per-iteration resource isolation)
 *  - resource in parallel (per-branch resource isolation)
 *  - typed child context: resource.provide adds keys that child tasks see typed
 */

import { createEngine, extension, flow, shape } from "@flowrun/core";
import type { Browser, Page } from "./shared/helpers.ts";
import { createBrowser, log, simulateWork, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// ── Browser extension ───────────────────────────────────────────────

const browserExtension = (browser: Browser) =>
    extension({
        name: "browser",
        provide() {
            return {
                provided: { browser },
                cleanup: (outcome) => {
                    log(`  [browser] extension disposed (run ended ${outcome.status})`);
                },
            };
        },
    });

interface BrowserShape {
    provided: {
        browser: Browser;
    };
}

// ── Engine ──────────────────────────────────────────────────────────

const browser = createBrowser();
const engine = createEngine().use(browserExtension(browser));
subscriber(engine.bus);

// ── Flow: data pipeline — used for FlowHandle demos ─────────────────

const pipeline = flow("data-pipeline")
    .state({ steps: [] as string[] })
    .nodes(({ parallel, task }) => [
        task({
            name: "fetch",
            run: async (context) => {
                await simulateWork(80, context.signal);
                context.state.append("steps", "fetch");
            },
        }),
        parallel({
            name: "process",
            merge: "overwrite",
            nodes: ({ task }) => [
                task({
                    name: "validate",
                    run: async (context) => {
                        await simulateWork(60, context.signal);
                        context.state.append("steps", "validate");
                    },
                }),
                task({
                    name: "enrich",
                    run: async (context) => {
                        await simulateWork(60, context.signal);
                        context.state.append("steps", "enrich");
                    },
                }),
            ],
        }),
        task({
            name: "save",
            run: async (context) => {
                await simulateWork(50, context.signal);
                context.state.append("steps", "save");
            },
        }),
    ]);

// ── Demo 1: register() returns a callable Flow — start() + join() ──

title("Demo 1 - register + start (Flow returned by register is invocable)");

const registered = engine.register(pipeline);
log(`registered: ${registered.name}`);

const handle1 = await registered.start();
log(`handle: flowName=${handle1.flowName}  runId=${handle1.runId}`);
log(`status: ${handle1.status()}`);

const result1 = await handle1.join();
log(`\nstatus: ${handle1.status()}`);
log(`result: ${result1.status}, duration: ${result1.duration}ms`);
log("steps:", result1.state.steps);

// ── Demo 2: cancel() with reason ────────────────────────────────────

title("Demo 2 - cancel");

const handle2 = await registered.start();

setTimeout(() => {
    log(`\n  -> cancelling (status was: ${handle2.status()})`);
    handle2.cancel("user pressed Ctrl+C");
    log(`  -> status now: ${handle2.status()}`);
}, 100);

const result2 = await handle2.join();
log(`\nresult: ${result2.status}`);
if (result2.status === "cancelled") {
    log(`reason: ${result2.reason}`);
}
log("tasks:", result2.tasks.map((result) => `${result.path}(${result.status})`).join(", "));

// ── Demo 3: pause() + resume() ──────────────────────────────────────

title("Demo 3 - pause + resume");

const handle3 = await registered.start();

setTimeout(() => {
    handle3.pause();
    log(`\n  -> paused (status: ${handle3.status()})`);

    setTimeout(() => {
        handle3.resume();
        log(`  -> resumed (status: ${handle3.status()})`);
    }, 200);
}, 100);

const result3 = await handle3.join();
log(`\nresult: ${result3.status}, duration: ${result3.duration}ms (includes ~200ms pause)`);
log("steps:", result3.state.steps);

// ── Flow: every + resource (per-iteration browser pages) ────────────

const months = ["2024-01", "2024-02", "2024-03", "2024-04"];

const scrapeFlow = shape<
    BrowserShape & {
        state: {
            scraped: { month: string; pageId: number }[];
        };
    }
>()
    .flow("scrape-invoices")
    .state({ scraped: [] as { month: string; pageId: number }[] })
    .nodes(({ every }) => [
        every({
            name: "scrape-month",
            items: () => months,
            concurrency: 2,
            merge: "append",

            // resource opens a fresh page per iteration and closes it on cleanup.
            // The returned keys are typed in the child context (context.page).
            // meta is EveryMeta<string>: index, item, nodeName.
            resource: {
                provide: async (context, meta) => {
                    log(`  [every meta] start iteration #${meta.index} item="${meta.item}"`);
                    return { page: await context.browser.newPage() };
                },
                cleanup: async (context, meta) => {
                    log(`  [every meta] cleanup iteration #${meta.index} item="${meta.item}" page=#${context.page.id}`);
                    await context.page.close();
                },
            },

            nodes: ({ task }) => [
                task({
                    name: "navigate",
                    run: async (context) => {
                        await context.page.goto(`https://portal.example.com/invoices?month=${context.iteration.item}`);
                    },
                }),
                task({
                    name: "extract",
                    run: (context) => {
                        context.state.set("scraped", [{ month: context.iteration.item, pageId: context.page.id }]);
                    },
                }),
            ],
        }),
    ]);

title("Demo 4 - resource in every (per-iteration pages)");

const scrapeResult = await engine.run(scrapeFlow);
log(`\nresult: ${scrapeResult.status}`);
for (const entry of scrapeResult.state.scraped) {
    log(`  ${entry.month} -> page #${entry.pageId}`);
}

// ── Flow: parallel + resource (per-branch browser pages) ────────────

const parallelScrape = shape<
    BrowserShape & {
        state: {
            invoicePage: number;
            reportPage: number;
        };
    }
>()
    .flow("parallel-scrape")
    .state({ invoicePage: 0, reportPage: 0 })
    .nodes(({ parallel }) => [
        parallel({
            name: "scrape-both",
            merge: "overwrite",

            // resource.provide receives meta with branchName/branchIndex; useful for logs and labels
            resource: {
                provide: async (context, meta) => {
                    const page: Page = await context.browser.newPage();
                    log(`  branch "${meta.branchName}" got page #${page.id}`);
                    return { page };
                },
                cleanup: async (context, meta) => {
                    log(`  branch "${meta.branchName}" released page #${context.page.id}`);
                    await context.page.close();
                },
            },

            nodes: ({ task }) => [
                task({
                    name: "scrape-invoices",
                    run: async (context) => {
                        await context.page.goto("https://portal.example.com/invoices");
                        context.state.set("invoicePage", context.page.id);
                    },
                }),
                task({
                    name: "scrape-reports",
                    run: async (context) => {
                        await context.page.goto("https://portal.example.com/reports");
                        context.state.set("reportPage", context.page.id);
                    },
                }),
            ],
        }),
    ]);

title("Demo 5 - resource in parallel (per-branch pages)");

const parallelResult = await engine.run(parallelScrape);
log(`\nresult: ${parallelResult.status}`);
log(`invoices -> page #${parallelResult.state.invoicePage}, reports -> page #${parallelResult.state.reportPage}`);
