/**
 * 05-extensions.ts — Extensions, Modules & Event Bus
 *
 * Covers:
 *  - event<T>(topic) creates a portable, typed event token (full topic, no prefix)
 *  - extension() declares the tokens it may emit via events: [token, ...]
 *  - setup(context) returns { provided, dispose } - replaces provide/provided/cleanup
 *  - requires<T>() declares a typed dependency on another extension's provided context;
 *    engine.use() enforces the order at compile time (MissingExtensionDependency)
 *  - Compose<[Shape, ...capabilities]> folds capability shapes (provided/params/state
 *    merge, events union) into the shape a flow is typed against
 *  - engine.use() chains extensions; historyLimit via engine config
 *  - engine.events.on(token) is fully typed; on(pattern) ("*", "**") is unknown
 *  - waitFor(token), history(pattern), subscription options (priority, filter, name, once)
 *  - context.emit(token) - emits one of the tokens in scope (extension or flow)
 */

import {
    type Compose,
    createEngine,
    type EventEnvelope,
    type EventSubscriber,
    event,
    extension,
    requires,
    type Subscription,
    shape,
    systemEvents,
} from "@flowrun/core";
import { log, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// ── Event tokens: defined once, shared by emitters and subscribers ──

const dbConnected = event<{ poolSize: number }>("database:connected");
const dbQuery = event<{ durationMs: number; sql: string }>("database:query");
const metricsFlushed = event<{ count: number }>("metrics:flushed");
const orderFetched = event<{ id: string }>("order:fetched");

// Shared shape of the context the database extension provides.
interface DbApi {
    query<TRow>(sql: string): Promise<TRow[]>;
}

// ── Extension 1: database - config factory + injected context ───────

const databaseExtension = (config: { connectionString: string }) =>
    extension({
        name: "database",
        events: [dbConnected, dbQuery],
        setup: (context) => {
            context.log.info(`Connecting to ${config.connectionString}`);
            // emit is fire-and-forget: it returns void and delivers on a later
            // microtask, so there is nothing to await.
            context.emit(dbConnected, { poolSize: 10 });

            return {
                provided: {
                    db: {
                        query: <TRow>(sql: string): Promise<TRow[]> => {
                            const start = Date.now();
                            const result: TRow[] = [];
                            context.emit(dbQuery, { durationMs: Date.now() - start, sql });
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
        events: [metricsFlushed],
        setup(context) {
            const counters = new Map<string, number>();
            // Guaranteed present (and typed) thanks to requires<{ db }>().
            const { db } = context.provided;

            // Subscribe to another extension's event by its token: the payload is
            // fully typed, no cast. Auto-unsubscribed at run end.
            context.on(dbQuery, (envelope) => {
                counters.set("db.queries", (counters.get("db.queries") ?? 0) + 1);
                context.log.info(`metric recorded for query: ${envelope.payload.sql}`);
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
                            context.emit(metricsFlushed, { count });
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

// Each extension's provided context as a reusable capability shape. Compose<[...]>
// folds them into one provided contract; params/state live on the builder below.
interface DatabaseShape {
    provided: { db: DbApi };
}

interface MetricsShape {
    provided: {
        metrics: {
            counter(name: string, value?: number): void;
            flush(): Promise<void>;
        };
    };
}

type SyncShape = Compose<[DatabaseShape, MetricsShape]>;

const sync = shape<SyncShape>();

// .params()/.state() set the flow's own data; .events([token]) declares its domain
// event tokens. context.emit is scoped to those tokens; subscribers listen by token.
const syncFlow = sync
    .flow("sync-data")
    .params<{ source: string }>()
    .events([orderFetched])
    .state((params) => ({ fetched: 0, source: params.source }))
    .nodes(({ task }) => [
        task({
            name: "fetch",
            run: async (context) => {
                const rows = await context.db.query<{ id: string }>(`SELECT * FROM ${context.params.source}`);
                context.state.set("fetched", rows.length);
                // context.emit publishes the flow-domain event declared via .events()
                context.emit(orderFetched, { id: "row-1" }, { correlationId: "trace-001" });
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

function dbActivitySubscriber(events: EventSubscriber) {
    const subscriptions: Subscription[] = [];

    // By token: payload typed as { durationMs, sql }.
    subscriptions.push(
        events.on(dbQuery, (envelope) => {
            log(`  [db-subscriber] query: ${envelope.payload.sql} (${envelope.payload.durationMs}ms)`);
        })
    );

    // By pattern: matches database:connected, database:query, etc. (payload unknown).
    subscriptions.push(
        events.on("database:*", (envelope) => {
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
engine.events.on(metricsFlushed, () => log("  [priority -10] pre-flush hook"), { priority: -10 });
engine.events.on(metricsFlushed, (envelope) => log(`  [priority  10] ${envelope.payload.count} metrics sent`), {
    priority: 10,
});

// filter: only react when payload matches
engine.events.on(systemEvents.node.task.ended, (envelope) => log(`  [filtered] task failed: ${envelope.nodeName}`), {
    filter: (envelope) => envelope.payload.status === "failed",
    name: "failure-monitor",
});

// flow-domain event by token: fully typed payload, no cast.
engine.events.on(orderFetched, (envelope) => {
    log(`  [domain] order:fetched id=${envelope.payload.id} correlationId=${envelope.correlationId ?? "-"}`);
});

// once: auto-unsubscribes after first delivery
engine.events.on(systemEvents.flow.started, (envelope) => log(`  [once] first flow started: ${envelope.flowName}`), {
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
    systemEvents.flow.started,
    () => {
        throw new Error("intentional handler error to demo bus.onError");
    },
    { name: "broken-handler" }
);

// ── Run ─────────────────────────────────────────────────────────────

title("Extensions + modules + event bus");

const flushPromise = engine.events.waitFor(metricsFlushed, { timeout: 5000 });
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
