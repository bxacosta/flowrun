import { defineFlow, FlowEngine } from "@flowrun/core";
import { consoleSubscriber } from "./shared/reporter.ts";

interface ImportParams {
    source: string;
}

interface ImportState {
    imported?: boolean;
    profile?: { name: string; source: string };
    stats?: { visits: number };
    tags?: string[];
}

const importFlow = defineFlow<ImportParams, ImportState>({
    id: "import-customer",
    name: "Import Customer",
    build: ({ parallel, sequence, step }) => [
        parallel(
            "load-customer-data",
            [
                sequence("profile-pipeline", [
                    step("fetch-profile", (ctx) => {
                        ctx.emit("log", {
                            level: "info",
                            message: "Loading profile",
                            data: { source: ctx.params.source },
                        });
                        ctx.state.set("profile", {
                            name: "Grace Hopper",
                            source: ctx.params.source,
                        });
                    }),
                ]),
                sequence("analytics-pipeline", [
                    step("fetch-stats", (ctx) => {
                        ctx.state.set("stats", { visits: 128 });
                    }),
                    step("fetch-tags", (ctx) => {
                        ctx.state.set("tags", ["vip", "newsletter"]);
                    }),
                ]),
            ],
            {
                concurrency: 2,
                mode: "all-settled",
            }
        ),
        step(
            "persist-import",
            (ctx) => {
                ctx.emit("log", {
                    level: "info",
                    message: "Persisting import",
                    data: ctx.state.snapshot() as Record<string, unknown>,
                });
                ctx.state.set("imported", true);
            },
            {
                retry: {
                    attempts: 3,
                    delayMs: 100,
                    strategy: "exponential",
                },
            }
        ),
    ],
});

const engine = new FlowEngine({
    subscribers: [consoleSubscriber],
});

const result = await engine.run(importFlow, { source: "crm" });

console.log("\nImported:", result.status);
console.log(result.state);
