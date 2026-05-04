/**
 * 05-extensions.ts — Extensions, Modules & Event Bus
 *
 * Covers:
 *  - define.extension() with public and internal events
 *  - event.public<T>() vs event.internal<T>() (visibility)
 *  - Extension config factory, provided context, cleanup()
 *  - define.module() to bundle extensions + flows for distribution
 *  - engine.use() chains extensions and modules; bufferSize via engine config
 *  - subscribe(), on() (pattern: *, **), waitFor(), history()
 *  - Subscription options: priority, filter, subscriberId, once
 *  - subscription.unsubscribe()
 *  - context.publish() with correlationId
 */

import type { EngineEvents, Envelope, ReadableBus, Subscription } from "@flowrun/core";
import { createEngine, define, event } from "@flowrun/core";
import { log, title } from "./shared/helpers.ts";

// ── Extension 1: database — config factory + provided context ───────

const databaseExtension = (config: { connectionString: string }) =>
    define.extension({
        name: "database",
        events: {
            "db:connected": event.internal<{ poolSize: number }>(),
            "db:query": event.public<{ duration: number; sql: string }>(),
        },
        provide: async (context) => {
            context.log.info(`Connecting to ${config.connectionString}`);
            await context.bus.publish("db:connected", { poolSize: 10 }, { source: "database" });

            return {
                db: {
                    query: async <TRow>(sql: string): Promise<TRow[]> => {
                        const start = Date.now();
                        const result: TRow[] = [];
                        await context.bus.publish(
                            "db:query",
                            { duration: Date.now() - start, sql },
                            { source: "database" }
                        );
                        return result;
                    },
                },
            };
        },
    });

// ── Extension 2: metrics — cross-extension listening + cleanup ──────

const metricsExtension = () =>
    define.extension({
        name: "metrics",
        events: {
            "metrics:flushed": event.public<{ count: number }>(),
        },
        provide(context) {
            const counters = new Map<string, number>();

            // Cross-extension listening: react to db:query events from the database extension
            context.bus.on("db:query", (envelope) => {
                counters.set("db.queries", (counters.get("db.queries") ?? 0) + 1);
                const payload = envelope.payload as { sql: string };
                context.log.info(`metric recorded for query: ${payload.sql}`);
            });

            return {
                metrics: {
                    counter: (name: string, value = 1) => {
                        counters.set(name, (counters.get(name) ?? 0) + value);
                    },
                    flush: async () => {
                        const count = counters.size;
                        context.log.info(`Flushed ${count} metrics`);
                        await context.bus.publish("metrics:flushed", { count }, { source: "metrics" });
                    },
                },
            };
        },
        cleanup() {
            log("  [metrics] disposed");
        },
    });

// ── Flow: uses extension-provided context ───────────────────────────

interface SyncContract {
    events: {
        "db:query": { duration: number; sql: string };
        "metrics:flushed": { count: number };
    };
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

const sync = define.scope<SyncContract>();

const syncFlow = sync.flow({
    name: "sync-data",
    state: (params) => ({ fetched: 0, source: params.source }),
    nodes: ({ task }) => [
        task({
            name: "fetch",
            run: async (context) => {
                const rows = await context.db.query<{ id: string }>(`SELECT * FROM ${context.params.source}`);
                context.state.set("fetched", rows.length);
                await context.publish(
                    "db:query",
                    { duration: 42, sql: "manual publish" },
                    { correlationId: "trace-001" }
                );
            },
        }),
        task({
            name: "report",
            run: async (context) => {
                context.metrics.counter("rows.fetched", context.state.get("fetched") ?? 0);
                await context.metrics.flush();
            },
        }),
    ],
});

// ── Module: bundle of extensions + flows ────────────────────────────

const syncModule = define.module({
    name: "sync-module",
    extensions: [databaseExtension({ connectionString: "postgresql://localhost/mydb" }), metricsExtension()],
    flows: [syncFlow],
});

// ── Engine: bufferSize for history(), onError for bus failures ──────

const engine = createEngine({
    events: {
        bufferSize: 50,
        onError: (error, context) => {
            log(`  [bus error] phase=${context.phase}: ${error.message}`);
        },
    },
}).use(syncModule);

// ── Standalone subscriber — reusable, externalizable ────────────────

function dbActivitySubscriber(bus: ReadableBus<EngineEvents<typeof engine>>) {
    const subscriptions: Subscription[] = [];

    subscriptions.push(
        bus.subscribe("db:query", (envelope) => {
            log(`  [db-subscriber] query: ${envelope.payload.sql} (${envelope.payload.duration}ms)`);
        })
    );

    // Wildcard subscription: matches db:connected, db:query, etc.
    subscriptions.push(
        bus.on("db:*", (envelope: Envelope) => {
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

const dbSubscriber = dbActivitySubscriber(engine.bus);

// priority: lower runs first
engine.bus.subscribe("metrics:flushed", () => log("  [priority -10] pre-flush hook"), { priority: -10 });
engine.bus.subscribe("metrics:flushed", (envelope) => log(`  [priority  10] ${envelope.payload.count} metrics sent`), {
    priority: 10,
});

// filter: only react when payload matches
engine.bus.subscribe("node:task:ended", (envelope) => log(`  [filtered] task failed: ${envelope.payload.nodeName}`), {
    filter: (envelope) => envelope.payload.status === "failed",
    subscriberId: "failure-monitor",
});

// once: auto-unsubscribes after first delivery
engine.bus.subscribe("flow:started", (envelope) => log(`  [once] first flow started: ${envelope.payload.flowName}`), {
    once: true,
});

const temporarySubscription = engine.bus.on("flow:*", (envelope: Envelope) => {
    log(`  [temp] ${envelope.topic} (will unsubscribe after first flow)`);
});

// Globstar (**): matches any depth — `node:**` captures node:task:started, node:every:ended, etc.
let nodeEventCount = 0;
const nodeGlobstar = engine.bus.on("node:**", () => {
    nodeEventCount++;
});

// Intentionally throwing handler — proves EventBusConfig.onError catches handler errors
engine.bus.subscribe(
    "flow:started",
    () => {
        throw new Error("intentional handler error to demo bus.onError");
    },
    { subscriberId: "broken-handler" }
);

// ── Run ─────────────────────────────────────────────────────────────

title("Extensions + modules + event bus");

const flushPromise = engine.bus.waitFor("metrics:flushed", { timeout: 5000 });
// syncFlow is registered via the module — look it up by name (type-erased).
const result = await engine.flow("sync-data").run({ source: "users" });
const flushEnvelope = await flushPromise;

log(`\nwaitFor resolved: ${flushEnvelope.payload.count} metrics`);

temporarySubscription.unsubscribe();
log(`\nUnsubscribed: ${temporarySubscription.subscriberId}`);

const dbHistory = engine.bus.history("db:*");
log(`\nHistory (db:*): ${dbHistory.length} events`);
for (const envelope of dbHistory) {
    log(`  ${envelope.topic} [correlationId: ${envelope.correlationId ?? "-"}]`);
}

const allHistory = engine.bus.history();
log(`\nHistory (no filter): ${allHistory.length} total events buffered`);

log(`\nGlobstar (node:**) captured ${nodeEventCount} events across all node depths`);
nodeGlobstar.unsubscribe();

log(`\nResult: ${result.status}`);

dbSubscriber.dispose();
