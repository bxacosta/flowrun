/**
 * 05-flow-control.ts — Flow Handle & Resource Isolation
 *
 * Covers:
 *  - flow.start() → FlowHandle
 *  - handle.join(), handle.status()
 *  - handle.cancel(reason) → CancelledFlowResult
 *  - handle.pause() / handle.resume()
 *  - context.signal (cooperative cancellation with AbortSignal)
 *  - forkProvided in every (per-iteration resource isolation)
 *  - forkProvided in parallel (per-branch resource isolation)
 *  - cleanupProvided (resource cleanup after fork)
 */

import { createEngine, defineExtension } from "@flowrun/core"
import { subscriber } from "./shared/subscriber.ts";
import type { Browser, Page } from "./shared/helpers.ts";
import { createBrowser, log, simulateWork, title } from "./shared/helpers.ts";

// ── Browser extension ───────────────────────────────────────────────

interface ProvidedWithPage {
    browser: Browser;
    page: Page;
}

const browserExtension = (browser: Browser) =>
    defineExtension({
        name: "browser",
        events: {},
        create() {
            return { browser };
        },
        dispose() {
            log("  [browser] extension disposed");
        },
    });

// ── Engine ──────────────────────────────────────────────────────────

const browser = createBrowser();
const engine = createEngine().extend(browserExtension(browser));
subscriber(engine.bus);

// ── Flow: data pipeline — used for FlowHandle demos ─────────────────

const pipeline = engine.flow({
    name: "data-pipeline",
    state: () => ({
        steps: [] as string[],
    }),

    nodes: ({ task, parallel }) => [
        task({
            name: "fetch",
            handler: async (context) => {
                await simulateWork(80, context.signal);
                context.state.set("steps", [...(context.state.get("steps") ?? []), "fetch"]);
            },
        }),

        parallel({
            name: "process",
            merge: "overwrite",
            nodes: ({ task }) => [
                task({
                    name: "validate",
                    handler: async (context) => {
                        await simulateWork(60, context.signal);
                        context.state.set("steps", [...(context.state.get("steps") ?? []), "validate"]);
                    },
                }),
                task({
                    name: "enrich",
                    handler: async (context) => {
                        await simulateWork(60, context.signal);
                        context.state.set("steps", [...(context.state.get("steps") ?? []), "enrich"]);
                    },
                }),
            ],
        }),

        task({
            name: "save",
            handler: async (context) => {
                await simulateWork(50, context.signal);
                context.state.set("steps", [...(context.state.get("steps") ?? []), "save"]);
            },
        }),
    ],
});

// ── Demo 1: start() + join() — equivalent to run() ─────────────────

title("Demo 1 · start + join");

const handle1 = await pipeline.start();
log(`handle: flowName=${handle1.flowName}  runId=${handle1.runId}`);
log(`status: ${handle1.status()}`);

const result1 = await handle1.join();
log(`\nstatus: ${handle1.status()}`);
log(`result: ${result1.status}, duration: ${result1.duration}ms`);
log("steps:", result1.state.steps);

// ── Demo 2: cancel() with reason ────────────────────────────────────

title("Demo 2 · cancel");

const handle2 = await pipeline.start();

setTimeout(() => {
    log(`\n  → cancelling (status was: ${handle2.status()})`);
    handle2.cancel("user pressed Ctrl+C");
    log(`  → status now: ${handle2.status()}`);
}, 100);

const result2 = await handle2.join();
log(`\nresult: ${result2.status}`);
if (result2.status === "cancelled") {
    log(`reason: ${result2.reason}`);
}
log(
    "tasks:",
    result2.tasks.map((result) => `${result.path}(${result.status})`).join(", "),
);

// ── Demo 3: pause() + resume() ──────────────────────────────────────

title("Demo 3 · pause + resume");

const handle3 = await pipeline.start();

setTimeout(() => {
    handle3.pause();
    log(`\n  → paused (status: ${handle3.status()})`);

    setTimeout(() => {
        handle3.resume();
        log(`  → resumed (status: ${handle3.status()})`);
    }, 200);
}, 100);

const result3 = await handle3.join();
log(`\nresult: ${result3.status}, duration: ${result3.duration}ms (includes ~200ms pause)`);
log("steps:", result3.state.steps);

// ── Flow: every + forkProvided (per-iteration browser pages) ────────

const months = ["2024-01", "2024-02", "2024-03", "2024-04"];

const scrapeFlow = engine.flow({
    name: "scrape-invoices",
    state: () => ({
        scraped: [] as { month: string; pageId: number }[],
    }),

    nodes: ({ every }) => [
        every({
            name: "scrape-month",
            items: () => months,
            concurrency: 2,
            merge: "append",

            forkProvided: async (provided) => {
                const page = await provided.browser.newPage();
                return { ...provided, page };
            },

            cleanupProvided: async (provided) => {
                const page = (provided as ProvidedWithPage).page;
                page.closed = true;
                log(`  [cleanup] page #${page.id} closed`);
            },

            nodes: ({ task }) => [
                task({
                    name: "navigate",
                    handler: async (context) => {
                        const page = (context as unknown as ProvidedWithPage).page;
                        await page.goto(
                            `https://portal.example.com/invoices?month=${context.iteration.item}`,
                        );
                    },
                }),
                task({
                    name: "extract",
                    handler: (context) => {
                        const page = (context as unknown as ProvidedWithPage).page;
                        context.state.set("scraped", [
                            { month: context.iteration.item, pageId: page.id },
                        ]);
                    },
                }),
            ],
        }),
    ],
});

title("Demo 4 · forkProvided in every (per-iteration pages)");

const scrapeResult = await scrapeFlow.run();
log(`\nresult: ${scrapeResult.status}`);
for (const entry of scrapeResult.state.scraped) {
    log(`  ${entry.month} → page #${entry.pageId}`);
}

// ── Flow: parallel + forkProvided (per-branch pages) ────────────────

const parallelScrape = engine.flow({
    name: "parallel-scrape",
    state: () => ({
        invoicePage: 0,
        reportPage: 0,
    }),

    nodes: ({ parallel }) => [
        parallel({
            name: "scrape-both",
            merge: "overwrite",

            forkProvided: async (provided, meta) => {
                const page = await provided.browser.newPage();
                log(`  branch "${meta.branchName}" got page #${page.id}`);
                return { ...provided, page };
            },

            cleanupProvided: async (provided, meta) => {
                const page = (provided as ProvidedWithPage).page;
                page.closed = true;
                log(`  branch "${meta.branchName}" released page #${page.id}`);
            },

            nodes: ({ task }) => [
                task({
                    name: "scrape-invoices",
                    handler: async (context) => {
                        const page = (context as unknown as ProvidedWithPage).page;
                        await page.goto("https://portal.example.com/invoices");
                        context.state.set("invoicePage", page.id);
                    },
                }),
                task({
                    name: "scrape-reports",
                    handler: async (context) => {
                        const page = (context as unknown as ProvidedWithPage).page;
                        await page.goto("https://portal.example.com/reports");
                        context.state.set("reportPage", page.id);
                    },
                }),
            ],
        }),
    ],
});

title("Demo 5 · forkProvided in parallel (per-branch pages)");

const parallelResult = await parallelScrape.run();
log(`\nresult: ${parallelResult.status}`);
log(
    `invoices → page #${parallelResult.state.invoicePage}, ` +
        `reports → page #${parallelResult.state.reportPage}`,
);
