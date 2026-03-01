import {FlowEngine, defineFlow} from "../src";
import {ConsoleReporter} from "./shared/reporter.ts";

interface ImportParams {
    source: string;
}

interface ImportState {
    profile?: { name: string; source: string };
    stats?: { visits: number };
    tags?: string[];
    imported?: boolean;
}

const importFlow = defineFlow<ImportParams, ImportState>({
    id: "import-customer",
    name: "Import Customer",
    build: ({parallel, sequence, step}) => [
        parallel(
            "load-customer-data",
            [
                sequence("profile-pipeline", [
                    step("fetch-profile", async (ctx) => {
                        ctx.log.info("Loading profile", {source: ctx.params.source});
                        ctx.state.set("profile", {
                            name: "Grace Hopper",
                            source: ctx.params.source,
                        });
                    }),
                ]),
                sequence("analytics-pipeline", [
                    step("fetch-stats", async (ctx) => {
                        ctx.state.set("stats", {visits: 128});
                    }),
                    step("fetch-tags", async (ctx) => {
                        ctx.state.set("tags", ["vip", "newsletter"]);
                    }),
                ]),
            ],
            {
                concurrency: 2,
                mode: "all-settled",
            },
        ),
        step(
            "persist-import",
            async (ctx) => {
                ctx.log.info("Persisting import", ctx.state.snapshot());
                ctx.state.set("imported", true);
            },
            {
                retry: {
                    attempts: 3,
                    delayMs: 100,
                    strategy: "exponential",
                },
            },
        ),
    ],
});

const engine = new FlowEngine({
    reporter: new ConsoleReporter(),
});

const result = await engine.run(importFlow, {source: "crm"});

console.log("\nImported:", result.status);
console.log(result.state);
