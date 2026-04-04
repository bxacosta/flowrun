import type {
    AnyEnvelope,
    AnyHandler,
    AnyPublishableBus,
    AnySubscribeOptions,
    Envelope,
    EventMap,
    PublishableBus,
    Subscription,
} from "./types.ts";

// ── Config ────────────────────────────────────────────────────────────

export interface EventBusConfig {
    bufferSize?: number;
    onError?: (error: Error, envelope: Envelope) => void;
}

// ── Internal Types ────────────────────────────────────────────────────

interface RegisteredHandler {
    filter?: (envelope: Envelope) => boolean;
    handler: AnyHandler;
    once: boolean;
    pattern: string;
    priority: number;
    regex: RegExp;
    subscriberId: string;
}

// ── InternalBus ───────────────────────────────────────────────────────

export interface InternalBus<TEvents extends EventMap> extends PublishableBus<TEvents, TEvents> {
    clear(): void;
    narrow<TPublicEvents extends EventMap, TAllEvents extends EventMap>(): PublishableBus<TPublicEvents, TAllEvents>;
}

// ── Implementation ────────────────────────────────────────────────────

function patternToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "<<GLOBSTAR>>")
        .replace(/\*/g, "[^:]+")
        .replace(/<<GLOBSTAR>>/g, ".+");
    return new RegExp(`^${escaped}$`);
}

export function createEventBus<TEvents extends EventMap>(config: EventBusConfig = {}): InternalBus<TEvents> {
    const handlers: RegisteredHandler[] = [];
    const buffer: Envelope[] = [];
    const maxBuffer = config.bufferSize ?? 0;
    let idCounter = 0;

    function removeHandler(entry: RegisteredHandler): void {
        const index = handlers.indexOf(entry);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    }

    async function dispatchToHandlers(envelope: Envelope, topic: string): Promise<void> {
        const matching = handlers.filter((entry) => entry.regex.test(topic));
        const toRemove: RegisteredHandler[] = [];

        for (const entry of matching) {
            if (entry.filter && !entry.filter(envelope)) {
                continue;
            }
            try {
                await entry.handler(envelope);
            } catch (error) {
                if (config.onError) {
                    config.onError(error as Error, envelope);
                } else {
                    console.error(`[EventBus] Error in "${entry.subscriberId}" for "${topic}":`, error);
                }
            }
            if (entry.once) {
                toRemove.push(entry);
            }
        }

        for (const entry of toRemove) {
            removeHandler(entry);
        }
    }

    function addHandler(pattern: string, handler: AnyHandler, options: AnySubscribeOptions = {}): Subscription {
        const entry: RegisteredHandler = {
            filter: options.filter,
            handler,
            once: options.once ?? false,
            pattern,
            priority: options.priority ?? 0,
            regex: patternToRegex(pattern),
            subscriberId: options.subscriberId ?? `sub_${++idCounter}`,
        };
        handlers.push(entry);
        handlers.sort((a, b) => a.priority - b.priority);
        return {
            subscriberId: entry.subscriberId,
            topic: entry.pattern,
            unsubscribe: () => removeHandler(entry),
        };
    }

    const bus: InternalBus<TEvents> = {
        clear() {
            handlers.length = 0;
        },

        history(topic) {
            if (!topic) {
                return [...buffer];
            }
            const regex = patternToRegex(topic);
            return buffer.filter((envelope) => regex.test(envelope.topic));
        },

        narrow() {
            return bus as unknown as AnyPublishableBus;
        },

        on(pattern, handler, options) {
            return addHandler(pattern, handler, options);
        },

        async publish(topic, payload, options = {}) {
            const envelope: Envelope = {
                correlationId: options.correlationId,
                id: `evt_${++idCounter}_${Date.now()}`,
                payload,
                source: options.source ?? "unknown",
                timestamp: Date.now(),
                topic,
            };

            if (maxBuffer > 0) {
                buffer.push(envelope);
                if (buffer.length > maxBuffer) {
                    buffer.shift();
                }
            }

            await dispatchToHandlers(envelope, topic);
        },

        subscribe(topic, handler, options) {
            return addHandler(topic, handler, options);
        },

        waitFor(topic, options = {}) {
            const { filter, timeout = 30_000 } = options;
            return new Promise((resolve, reject) => {
                const timer =
                    timeout > 0
                        ? setTimeout(() => {
                              subscription.unsubscribe();
                              reject(new Error(`waitFor("${topic}") timed out after ${timeout}ms`));
                          }, timeout)
                        : null;

                const subscription = addHandler(
                    topic,
                    (envelope) => {
                        if (filter && !filter(envelope as AnyEnvelope)) {
                            return;
                        }
                        if (timer) {
                            clearTimeout(timer);
                        }
                        resolve(envelope as AnyEnvelope);
                    },
                    { once: true }
                );
            });
        },
    };

    return bus;
}
