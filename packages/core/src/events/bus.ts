/**
 * events/bus.ts — In-memory event bus
 *
 * Layer: L2. Pattern-matched pub/sub with history buffer, priority ordering,
 * filters, once, and waitFor. Owns emit metadata construction.
 */

import { FlowEngineError, normalizeError } from "../core/errors.ts";
import { assertValidPattern } from "../core/validation.ts";
import type {
    EventMap,
    EventSource,
    EventSubscriber,
    EventEnvelope,
    OnOptions,
    Subscription,
    WaitForOptions,
} from "./types.ts";

// ── Emit metadata ───────────────────────────────────────────────────

export interface EmitMeta {
    correlationId?: string;
    flowName: string;
    iteration?: { index: number; item: unknown };
    nodeName?: string;
    path?: readonly string[];
    runId: string;
    source: EventSource;
}

export interface EmitMetaLocation {
    correlationId?: string;
    iteration?: { index: number; item: unknown };
    nodeName?: string;
    path?: readonly string[];
}

export function createEmitMeta(
    source: EventSource,
    base: { flowName: string; runId: string },
    location: EmitMetaLocation = {}
): EmitMeta {
    return {
        correlationId: location.correlationId,
        flowName: base.flowName,
        iteration: location.iteration,
        nodeName: location.nodeName,
        path: location.path,
        runId: base.runId,
        source,
    };
}

// ── Config & errors ─────────────────────────────────────────────────

export type EventBusErrorContext =
    | { event: EventEnvelope; name: string; pattern: string; phase: "filter" }
    | { event: EventEnvelope; name: string; pattern: string; phase: "handler" }
    | { phase: "waitFor"; timeout: number; topic: string }
    | { definitionName: string; phase: "requestSubscriber"; requestId: string };

export type EventBusErrorHandler = (error: Error, context: EventBusErrorContext) => void;

export interface EventBusConfig {
    historyLimit?: number;
    onError?: EventBusErrorHandler;
}

// ── Bus interface ───────────────────────────────────────────────────

export interface EventBus<TEvents extends EventMap> extends EventSubscriber<TEvents> {
    asReadable<TView extends EventMap = TEvents>(): EventSubscriber<TView>;
    clear(): void;
    emit<K extends keyof TEvents & string>(topic: K, payload: TEvents[K], meta: EmitMeta): void;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased emitter for runtime use
export type AnyEventBus = EventBus<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased handler stored at runtime
type AnyHandler = (event: EventEnvelope<any>) => void | Promise<void>;

interface RegisteredHandler {
    filter?: (event: EventEnvelope) => boolean;
    handler: AnyHandler;
    name: string;
    once: boolean;
    pattern: string;
    priority: number;
    regex: RegExp;
}

// ── Pattern matching ────────────────────────────────────────────────

function patternToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "<<GLOBSTAR>>")
        .replace(/\*/g, "[^:]+")
        .replace(/<<GLOBSTAR>>/g, ".+");
    return new RegExp(`^${escaped}$`);
}

// ── Factory ─────────────────────────────────────────────────────────

export function createEventBus<TEvents extends EventMap>(config: EventBusConfig = {}): EventBus<TEvents> {
    const handlers: RegisteredHandler[] = [];
    const buffer: EventEnvelope[] = [];
    const maxHistory = config.historyLimit ?? 0;
    let nameCounter = 0;

    function reportError(error: unknown, context: EventBusErrorContext): void {
        const normalized = normalizeError(error);
        if (!config.onError) {
            console.error(`[EventBus] ${context.phase} error:`, normalized);
            return;
        }
        try {
            config.onError(normalized, context);
        } catch (onErrorFailure) {
            console.error(
                `[EventBus] onError threw while handling a "${context.phase}" error:`,
                normalizeError(onErrorFailure),
                { context, originalError: normalized }
            );
        }
    }

    function removeHandler(entry: RegisteredHandler): void {
        const index = handlers.indexOf(entry);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    }

    function addHandler(pattern: string, handler: AnyHandler, options: OnOptions = {}): Subscription {
        assertValidPattern(pattern);
        const entry: RegisteredHandler = {
            filter: options.filter as ((event: EventEnvelope) => boolean) | undefined,
            handler,
            name: options.name ?? `sub_${++nameCounter}`,
            once: options.once ?? false,
            pattern,
            priority: options.priority ?? 0,
            regex: patternToRegex(pattern),
        };
        // Insert keeping handlers sorted by ascending priority, stable among equal
        // priorities (new entry goes after existing ones), instead of re-sorting the
        // whole array on every subscribe.
        const insertAt = handlers.findIndex((existing) => existing.priority > entry.priority);
        handlers.splice(insertAt === -1 ? handlers.length : insertAt, 0, entry);
        return {
            name: entry.name,
            topic: entry.pattern,
            unsubscribe: () => removeHandler(entry),
        };
    }

    function passesFilter(entry: RegisteredHandler, event: EventEnvelope): boolean {
        if (!entry.filter) {
            return true;
        }
        try {
            return entry.filter(event);
        } catch (error) {
            reportError(error, { event, name: entry.name, pattern: entry.pattern, phase: "filter" });
            return false;
        }
    }

    async function notifyHandler(entry: RegisteredHandler, event: EventEnvelope): Promise<void> {
        try {
            await entry.handler(event);
        } catch (error) {
            reportError(error, { event, name: entry.name, pattern: entry.pattern, phase: "handler" });
        }
    }

    async function dispatch(event: EventEnvelope): Promise<void> {
        const matching = handlers.filter((entry) => entry.regex.test(event.topic));

        for (const entry of matching) {
            if (!passesFilter(entry, event)) {
                continue;
            }
            if (entry.once) {
                removeHandler(entry);
            }
            await notifyHandler(entry, event);
        }
    }

    function buildEvent(topic: string, payload: unknown, meta: EmitMeta): EventEnvelope {
        const event: EventEnvelope = {
            correlationId: meta.correlationId,
            flowName: meta.flowName,
            id: crypto.randomUUID(),
            iteration: meta.iteration,
            nodeName: meta.nodeName,
            path: meta.path,
            payload,
            runId: meta.runId,
            source: meta.source,
            timestamp: Date.now(),
            topic,
        };
        return event;
    }

    const bus: EventBus<TEvents> = {
        asReadable<TView extends EventMap = TEvents>() {
            return bus as unknown as EventSubscriber<TView>;
        },

        clear() {
            handlers.length = 0;
        },

        emit(topic, payload, meta) {
            const event = buildEvent(topic, payload, meta);
            if (maxHistory > 0) {
                buffer.push(event);
                if (buffer.length > maxHistory) {
                    buffer.shift();
                }
            }
            queueMicrotask(() => {
                dispatch(event);
            });
        },

        history(pattern) {
            if (pattern === undefined) {
                return [...buffer];
            }
            assertValidPattern(pattern);
            const regex = patternToRegex(pattern);
            return buffer.filter((event) => regex.test(event.topic));
        },

        on: ((pattern: string, handler: AnyHandler, options?: OnOptions<unknown>): Subscription =>
            addHandler(pattern, handler, options as OnOptions | undefined)) as EventBus<TEvents>["on"],

        waitFor<K extends keyof TEvents & string>(
            topic: K,
            options: WaitForOptions<TEvents[K]> = {}
        ): Promise<EventEnvelope<TEvents[K]>> {
            const { filter, signal, timeout } = options;
            if (timeout !== undefined && timeout <= 0) {
                throw new FlowEngineError(`waitFor("${topic}"): timeout must be > 0 (omit it to wait indefinitely)`);
            }

            return new Promise<EventEnvelope<TEvents[K]>>((resolve, reject) => {
                let settled = false;
                const subscriberName = `wait_${++nameCounter}`;

                const cleanup = () => {
                    if (timer) {
                        clearTimeout(timer);
                    }
                    if (signal) {
                        signal.removeEventListener("abort", onAbort);
                    }
                    subscription.unsubscribe();
                };

                const onAbort = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    cleanup();
                    reject(signal?.reason ?? new Error(`waitFor("${topic}") aborted`));
                };

                const timer =
                    timeout === undefined
                        ? null
                        : setTimeout(() => {
                              if (settled) {
                                  return;
                              }
                              settled = true;
                              cleanup();
                              const error = new Error(`waitFor("${topic}") timed out after ${timeout}ms`);
                              reportError(error, { phase: "waitFor", timeout, topic });
                              reject(error);
                          }, timeout);

                if (signal) {
                    if (signal.aborted) {
                        settled = true;
                        if (timer) {
                            clearTimeout(timer);
                        }
                        reject(signal.reason ?? new Error(`waitFor("${topic}") aborted`));
                        return;
                    }
                    signal.addEventListener("abort", onAbort, { once: true });
                }

                const subscription = addHandler(
                    topic,
                    (event) => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        cleanup();
                        resolve(event as EventEnvelope<TEvents[K]>);
                    },
                    { filter: filter as ((event: EventEnvelope) => boolean) | undefined, name: subscriberName, once: true }
                );
            });
        },
    };

    return bus;
}
