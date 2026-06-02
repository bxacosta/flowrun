/**
 * 05-extensions.ts — Extensions, Modules & Event Bus
 *
 * Covers:
 *  - extension() with a single event<T>() marker (auto-prefixed by extension name)
 *  - setup(context) returns { provided, dispose } - replaces provide/provided/cleanup
 *  - requires<T>() declares a typed dependency on another extension's provided context;
 *    engine.use() enforces the order at compile time (MissingExtensionDependency)
 *  - engine.use() chains extensions; historyLimit via engine config
 *  - engine.events.on() (typed key or wildcard pattern), waitFor(), history()
 *  - Subscription options: priority, filter, name, once
 *  - subscription.unsubscribe()
 *  - context.emit() (flow domain events declared via .events<T>())
 */

import type { EngineEvents, EventEnvelope, EventSubscriber, Subscription } from "@flowrun/core";
import { createEngine, event, extension, requires, shape } from "@flowrun/core";
import { log, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// Shared shape of the context the database extension provides.
interface DbApi {
    query<TRow>(sql: string): Promise<TRow[]>;
}

// ── Extension 1: database - config factory + injected context ───────

const databaseExtension = (config: { connectionString: string }) =>
    extension({
        name: "database",
        events: {
            connected: event<{ poolSize: number }>(),
            query: event<{ durationMs: number; sql: string }>(),
        },
        setup: (context) => {
            context.log.info(`Connecting to ${config.connectionString}`);
            // emit is fire-and-forget: it returns void and delivers on a later
            // microtask, so there is nothing to await.
            context.emit("connected", { poolSize: 10 });

            return {
                provided: {
                    db: {
                        query: <TRow>(sql: string): Promise<TRow[]> => {
                            const start = Date.now();
                            const result: TRow[] = [];
                            context.emit("query", { durationMs: Date.now() - start, sql });
                            return Promise.resolve(result);
                        },
                    },
                },
            };
        },
    });

// ── Extension 2: metrics - cross-extension listening + dispose ──────

const metricsExtension = () =>
    extension({
        name: "metrics",
        // requires() declares a typed dependency on context an earlier extension
        // provided. context.provided is then typed as { db }, and engine.use()
        // refuses to compile if database wasn't .use()'d first.
        requires: requires<{ db: DbApi }>(),
        events: {
            flushed: event<{ count: number }>(),
        },
        setup(context) {
            const counters = new Map<string, number>();
            // Guaranteed present (and typed) thanks to requires<{ db }>().
            const { db } = context.provided;

            // Listen to another extension's events (its payload is outside this
            // extension's typed set, so cast it). Auto-unsubscribed at run end.
            context.on("database:query", (envelope) => {
                const payload = envelope.payload as { durationMs: number; sql: string };
                counters.set("db.queries", (counters.get("db.queries") ?? 0) + 1);
                context.log.info(`metric recorded for query: ${payload.sql}`);
            });

            return {
                provided: {
                    metrics: {
                        counter: (name: string, value = 1) => {
                            counters.set(name, (counters.get(name) ?? 0) + value);
                        },
                        flush: async () => {
                            const count = counters.size;
                            // Uses the required db dependency to persist the snapshot.
                            await db.query(`INSERT INTO metric_snapshots (count) VALUES (${count})`);
                            context.log.info(`Flushed ${count} metrics`);
                            context.emit("flushed", { count });
                        },
                    },
                },
                dispose: (outcome) => {
                    context.log.info(`metrics disposed (run ended ${outcome.status})`);
                },
            };
        },
    });

// ── Flow: uses extension-provided context ───────────────────────────

interface SyncShape {
    params: { source: string };
    provided: {
        db: DbApi;
        metrics: {
            counter(name: string, value?: number): void;
            flush(): Promise<void>;
        };
    };
    state: { fetched: number; source: string };
}

const sync = shape<SyncShape>();

// .events<T>() declares the flow's own domain events on the builder. They type
// context.emit inside the flow; subscribers listen for the bare topic on the bus.
const syncFlow = sync
    .flow("sync-data")
    .events<{ "order:fetched": { id: string } }>()
    .state((params) => ({ fetched: 0, source: params.source }))
    .nodes(({ task }) => [
        task({
            name: "fetch",
            run: async (context) => {
                const rows = await context.db.query<{ id: string }>(`SELECT * FROM ${context.params.source}`);
                context.state.set("fetched", rows.length);
                // context.emit publishes the flow-domain event declared via .events()
                context.emit("order:fetched", { id: "row-1" }, { correlationId: "trace-001" });
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

// ── Engine: historyLimit for history(), onError for bus failures ──────

const engine = createEngine({
    events: {
        historyLimit: 50,
        onError: (error, context) => {
            log(`  [bus error] phase=${context.phase}: ${error.message}`);
        },
    },
})
    // Order matters: metrics requires<{ db }>(), so database must come first.
    // Swapping these two lines is a compile-time error (MissingExtensionDependency).
    .use(databaseExtension({ connectionString: "postgresql://localhost/mydb" }))
    .use(metricsExtension());

// The shared subscriber prints the run/flow/task lifecycle; the custom
// subscribers below add the bus-specific (extension/domain event) detail.
subscriber(engine.events);

// ── Standalone subscriber - reusable, externalizable ────────────────

function dbActivitySubscriber(events: EventSubscriber<EngineEvents<typeof engine>>) {
    const subscriptions: Subscription[] = [];

    subscriptions.push(
        events.on("database:query", (envelope) => {
            log(`  [db-subscriber] query: ${envelope.payload.sql} (${envelope.payload.durationMs}ms)`);
        })
    );

    // Wildcard subscription: matches database:connected, database:query, etc.
    subscriptions.push(
        events.on("database:*", (envelope: EventEnvelope) => {
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

// flow-domain event declared via .events(): subscribers listen for the bare topic.
// It isn't in the engine's typed event map, so the payload is cast at the use site.
engine.events.on("order:fetched", (envelope: EventEnvelope) => {
    const payload = envelope.payload as { id: string };
    log(`  [domain] order:fetched id=${payload.id} correlationId=${envelope.correlationId ?? "-"}`);
});

// once: auto-unsubscribes after first delivery
engine.events.on("flow:started", (envelope) => log(`  [once] first flow started: ${envelope.flowName}`), {
    once: true,
});

const temporarySubscription = engine.events.on("flow:*", (envelope: EventEnvelope) => {
    log(`  [temp] ${envelope.topic} (will unsubscribe after first flow)`);
});

// Globstar (**): matches any depth - `node:**` captures node:task:started, node:each:ended, etc.
let nodeEventCount = 0;
const nodeGlobstar = engine.events.on("node:**", () => {
    nodeEventCount++;
});

// Intentionally throwing handler - proves EventBusConfig.onError catches handler errors
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
