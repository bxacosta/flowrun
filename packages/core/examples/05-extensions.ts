/**
 * 05-extensions.ts — Extensions, Modules & Event Bus
 *
 * Covers:
 *  - extension() with a single event<T>() marker (auto-prefixed by extension name)
 *  - setup(context) returns { context, dispose } — replaces provide/provided/cleanup
 *  - engine.use() chains extensions; bufferSize via engine config
 *  - engine.events.on() (typed key or wildcard pattern), waitFor(), history()
 *  - Subscription options: priority, filter, name, once
 *  - subscription.unsubscribe()
 *  - context.emit() (flow domain events declared via .emits<T>())
 */

import type { EngineEvents, EventStream, FlowEvent, Subscription } from "@flowrun/core";
import { createEngine, event, extension, shape } from "@flowrun/core";
import { log, title } from "./shared/helpers.ts";

// ── Extension 1: database — config factory + injected context ───────

const databaseExtension = (config: { connectionString: string }) =>
    extension({
        name: "database",
        events: {
            connected: event<{ poolSize: number }>(),
            query: event<{ durationMs: number; sql: string }>(),
        },
        setup: async (context) => {
            context.log.info(`Connecting to ${config.connectionString}`);
            await context.emit("connected", { poolSize: 10 });

            return {
                context: {
                    db: {
                        query: async <TRow>(sql: string): Promise<TRow[]> => {
                            const start = Date.now();
                            const result: TRow[] = [];
                            await context.emit("query", { durationMs: Date.now() - start, sql });
                            return result;
                        },
                    },
                },
            };
        },
    });

// ── Extension 2: metrics — cross-extension listening + dispose ──────

const metricsExtension = () =>
    extension({
        name: "metrics",
        events: {
            flushed: event<{ count: number }>(),
        },
        setup(context) {
            const counters = new Map<string, number>();

            // Cross-extension listening: react to database:query events.
            // Other extensions' events aren't in this extension's typed set,
            // so we cast the payload at the use site.
            // The subscription is auto-cleaned up at the end of the run.
            context.on("database:query", (envelope) => {
                const payload = envelope.payload as { durationMs: number; sql: string };
                counters.set("db.queries", (counters.get("db.queries") ?? 0) + 1);
                context.log.info(`metric recorded for query: ${payload.sql}`);
            });

            return {
                context: {
                    metrics: {
                        counter: (name: string, value = 1) => {
                            counters.set(name, (counters.get(name) ?? 0) + value);
                        },
                        flush: async () => {
                            const count = counters.size;
                            context.log.info(`Flushed ${count} metrics`);
                            await context.emit("flushed", { count });
                        },
                    },
                },
                dispose: (outcome) => {
                    log(`  [metrics] disposed (run ended ${outcome.status})`);
                },
            };
        },
    });

// ── Flow: uses extension-provided context ───────────────────────────

interface SyncShape {
    events: { "order:fetched": { id: string } };
    params: { source: string };
    provided: {
        db: { query<TRow>(sql: string): Promise<TRow[]> };
        metrics: {
            counter(name: string, value?: number): void;
            flush(): Promise<void>;
        };
    };
    state: { fetched: number; source: string };
}

const sync = shape<SyncShape>();

const syncFlow = sync
    .flow("sync-data")
    .state((params) => ({ fetched: 0, source: params.source }))
    .nodes(({ task }) => [
        task({
            name: "fetch",
            run: async (context) => {
                const rows = await context.db.query<{ id: string }>(`SELECT * FROM ${context.params.source}`);
                context.state.set("fetched", rows.length);
                // context.emit publishes a flow-domain event declared in SyncShape.events
                await context.emit("order:fetched", { id: "row-1" }, { correlationId: "trace-001" });
            },
        }),
        task({
            name: "report",
            run: async (context) => {
                context.metrics.counter("rows.fetched", context.state.get("fetched") ?? 0);
                await context.metrics.flush();
            },
        }),
    ]);

// ── Engine: bufferSize for history(), onError for bus failures ──────

const engine = createEngine({
    events: {
        bufferSize: 50,
        onError: (error, context) => {
            log(`  [bus error] phase=${context.phase}: ${error.message}`);
        },
    },
})
    .use(databaseExtension({ connectionString: "postgresql://localhost/mydb" }))
    .use(metricsExtension());

// ── Standalone subscriber — reusable, externalizable ────────────────

function dbActivitySubscriber(events: EventStream<EngineEvents<typeof engine>>) {
    const subscriptions: Subscription[] = [];

    subscriptions.push(
        events.on("database:query", (envelope) => {
            log(`  [db-subscriber] query: ${envelope.payload.sql} (${envelope.payload.durationMs}ms)`);
        })
    );

    // Wildcard subscription: matches database:connected, database:query, etc.
    subscriptions.push(
        events.on("database:*", (envelope: FlowEvent) => {
            log(`  [db-subscriber] event: ${envelope.topic}`);
        })
    );

    return {
        dispose() {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        },
    };
}

// ── Register subscribers ────────────────────────────────────────────

const dbSubscriber = dbActivitySubscriber(engine.events);

// priority: lower runs first
engine.events.on("metrics:flushed", () => log("  [priority -10] pre-flush hook"), { priority: -10 });
engine.events.on("metrics:flushed", (envelope) => log(`  [priority  10] ${envelope.payload.count} metrics sent`), {
    priority: 10,
});

// filter: only react when payload matches
engine.events.on("node:task:ended", (envelope) => log(`  [filtered] task failed: ${envelope.nodeName}`), {
    filter: (envelope) => envelope.payload.status === "failed",
    name: "failure-monitor",
});

// once: auto-unsubscribes after first delivery
engine.events.on("flow:started", (envelope) => log(`  [once] first flow started: ${envelope.flowName}`), {
    once: true,
});

const temporarySubscription = engine.events.on("flow:*", (envelope: FlowEvent) => {
    log(`  [temp] ${envelope.topic} (will unsubscribe after first flow)`);
});

// Globstar (**): matches any depth — `node:**` captures node:task:started, node:every:ended, etc.
let nodeEventCount = 0;
const nodeGlobstar = engine.events.on("node:**", () => {
    nodeEventCount++;
});

// Intentionally throwing handler — proves EventBusConfig.onError catches handler errors
engine.events.on(
    "flow:started",
    () => {
        throw new Error("intentional handler error to demo bus.onError");
    },
    { name: "broken-handler" }
);

// ── Run ─────────────────────────────────────────────────────────────

title("Extensions + modules + event bus");

const flushPromise = engine.events.waitFor("metrics:flushed", { timeout: 5000 });
const result = await engine.run(syncFlow, { source: "users" });
const flushEnvelope = await flushPromise;

log(`\nwaitFor resolved: ${flushEnvelope.payload.count} metrics`);

temporarySubscription.unsubscribe();
log(`\nUnsubscribed: ${temporarySubscription.name}`);

const dbHistory = engine.events.history("database:*");
log(`\nHistory (database:*): ${dbHistory.length} events`);
for (const envelope of dbHistory) {
    log(`  ${envelope.topic} [correlationId: ${envelope.correlationId ?? "-"}]`);
}

const allHistory = engine.events.history();
log(`\nHistory (no filter): ${allHistory.length} total events buffered`);

log(`\nGlobstar (node:**) captured ${nodeEventCount} events across all node depths`);
nodeGlobstar.unsubscribe();

log(`\nResult: ${result.status}`);

dbSubscriber.dispose();
