/**
 * 04-extensions-and-events.ts — Extensions & Event Bus
 *
 * Covers:
 *  - defineExtension() with public and internal events
 *  - event<T>() vs internal<T>() (visibility)
 *  - Extension config factory, provided context, dispose()
 *  - engine.extend() chaining, bufferSize config
 *  - subscribe(), on() (pattern: *, **), waitFor(), history()
 *  - Subscription options: priority, filter, subscriberId, once
 *  - subscription.unsubscribe()
 *  - context.publish() with correlationId
 */

import { createEngine, defineExtension, event, internal } from "@flowrun/core"
import type { EngineEvents, Envelope, ReadableBus, Subscription } from "@flowrun/core"
import { log, title } from "./shared/helpers.ts";

// ── Extension 1: database — config factory + provided context ───────

const databaseExtension = (config: { connectionString: string }) =>
    defineExtension({
        name: "database",
        events: {
            "db:connected": internal<{ poolSize: number }>(),
            "db:query": event<{ duration: number; sql: string }>(),
        },
        create(context) {
            context.log.info(`Connecting to ${config.connectionString}`);
            void context.bus.publish("db:connected", { poolSize: 10 }, { source: "database" });

            return {
                db: {
                    query: async <TRow>(sql: string): Promise<TRow[]> => {
                        const start = Date.now();
                        const result: TRow[] = [];
                        void context.bus.publish(
                            "db:query",
                            { duration: Date.now() - start, sql },
                            { source: "database" },
                        );
                        return result;
                    },
                },
            };
        },
    });

// ── Extension 2: metrics — cross-extension listening + dispose ──────

const metricsExtension = () =>
    defineExtension({
        name: "metrics",
        events: {
            "metrics:flushed": event<{ count: number }>(),
        },
        create(context) {
            const counters = new Map<string, number>();

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
        dispose() {
            log("  [metrics] disposed");
        },
    });

// ── Engine with extensions + buffer ─────────────────────────────────

const engine = createEngine({ bufferSize: 50 })
    .extend(databaseExtension({ connectionString: "postgresql://localhost/mydb" }))
    .extend(metricsExtension());

// ── Standalone subscriber — reusable, externalizable ────────────────

function dbActivitySubscriber(bus: ReadableBus<EngineEvents<typeof engine>>) {
    const subscriptions: Subscription[] = [];

    subscriptions.push(
        bus.subscribe("db:query", (envelope) => {
            log(`  [db-subscriber] query: ${envelope.payload.sql} (${envelope.payload.duration}ms)`);
        }),
    );

    subscriptions.push(
        bus.on("db:*", (envelope: Envelope) => {
            log(`  [db-subscriber] event: ${envelope.topic}`);
        }),
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

engine.bus.subscribe("metrics:flushed", () => log("  [priority -10] pre-flush hook"), { priority: -10 });

engine.bus.subscribe(
    "metrics:flushed",
    (envelope) => log(`  [priority  10] ${envelope.payload.count} metrics sent`),
    { priority: 10 },
);

engine.bus.subscribe(
    "node:task:end",
    (envelope) => log(`  [filtered] task failed: ${envelope.payload.nodeName}`),
    { filter: (envelope) => envelope.payload.status === "failed", subscriberId: "failure-monitor" },
);

engine.bus.subscribe(
    "flow:start",
    (envelope) => log(`  [once] first flow started: ${envelope.payload.flowName}`),
    { once: true },
);

const temporarySubscription = engine.bus.on("flow:*", (envelope: Envelope) => {
    log(`  [temp] ${envelope.topic} (will unsubscribe after first flow)`);
});

// ── Flow: uses extension-provided context ───────────────────────────

const syncFlow = engine.flow({
    name: "sync-data",
    state: (params: { source: string }) => ({ fetched: 0, source: params.source }),

    nodes: ({ task }) => [
        task({
            name: "fetch",
            handler: async (context) => {
                const rows = await context.db.query<{ id: string }>(
                    `SELECT * FROM ${context.params.source}`,
                );
                context.state.set("fetched", rows.length);
                context.publish(
                    "db:query",
                    { duration: 42, sql: "manual publish" },
                    { correlationId: "trace-001" },
                );
            },
        }),
        task({
            name: "report",
            handler: async (context) => {
                context.metrics.counter("rows.fetched", context.state.get("fetched") ?? 0);
                await context.metrics.flush();
            },
        }),
    ],
});

// ── Run ─────────────────────────────────────────────────────────────

title("Extensions + Event Bus");

const flushPromise = engine.bus.waitFor("metrics:flushed", { timeout: 5000 });
const result = await syncFlow.run({ source: "users" });
const flushEnvelope = await flushPromise;

log(`\nwaitFor resolved: ${flushEnvelope.payload.count} metrics`);

temporarySubscription.unsubscribe();
log(`\nUnsubscribed: ${temporarySubscription.subscriberId}`);

const dbHistory = engine.bus.history("db:*");
log(`\nHistory (db:*): ${dbHistory.length} events`);
for (const envelope of dbHistory) {
    log(`  ${envelope.topic} [correlationId: ${envelope.correlationId ?? "—"}]`);
}

log(`\nResult: ${result.status}`);

dbSubscriber.dispose();
