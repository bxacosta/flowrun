import { normalizeError } from "./errors.ts";
import type { Envelope, EventMap } from "./events.ts";

export interface Subscription {
    subscriberId: string;
    topic: string;
    unsubscribe: () => void;
}

export interface SubscribeOptions<TPayload = unknown> {
    filter?: (envelope: Envelope<TPayload>) => boolean;
    once?: boolean;
    priority?: number;
    subscriberId?: string;
}

export type Handler<TPayload> = (envelope: Envelope<TPayload>) => void | Promise<void>;

export type EventBusReportedErrorContext =
    | {
          envelope: Envelope;
          pattern: string;
          phase: "filter";
          subscriberId: string;
      }
    | {
          envelope: Envelope;
          pattern: string;
          phase: "handler";
          subscriberId: string;
      }
    | {
          payload: unknown;
          phase: "publish";
          source: string;
          topic: string;
      }
    | {
          phase: "waitFor";
          timeout: number;
          topic: string;
      };

export type EventBusErrorContext =
    | EventBusReportedErrorContext
    | {
          failedContext: EventBusReportedErrorContext;
          originalError: Error;
          phase: "onError";
      };

export type EventBusErrorHandler = (error: Error, context: EventBusErrorContext) => void;

// biome-ignore lint/suspicious/noExplicitAny: type-erased event handler for bus internals
export type AnyHandler = Handler<any>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased subscribe options for bus internals
export type AnySubscribeOptions = SubscribeOptions<any>;

export interface ReadableBus<TAllEvents extends EventMap> {
    history(topic?: string): Envelope[];
    on(pattern: string, handler: Handler<unknown>, options?: SubscribeOptions): Subscription;
    subscribe<K extends keyof TAllEvents & string>(
        topic: K,
        handler: Handler<TAllEvents[K]>,
        options?: SubscribeOptions<TAllEvents[K]>
    ): Subscription;
    waitFor<K extends keyof TAllEvents & string>(
        topic: K,
        options?: { filter?: (envelope: Envelope<TAllEvents[K]>) => boolean; timeout?: number }
    ): Promise<Envelope<TAllEvents[K]>>;
}

export interface PublishableBus<TPublishableEvents extends EventMap, TAllEvents extends EventMap>
    extends ReadableBus<TAllEvents> {
    publish<K extends keyof TPublishableEvents & string>(
        topic: K,
        payload: TPublishableEvents[K],
        options?: { correlationId?: string; source?: string }
    ): Promise<void>;
}

export interface EventBusConfig {
    bufferSize?: number;
    onError?: EventBusErrorHandler;
}

interface RegisteredHandler {
    filter?: (envelope: Envelope) => boolean;
    handler: Handler<unknown>;
    once: boolean;
    pattern: string;
    priority: number;
    regex: RegExp;
    subscriberId: string;
}

export interface InternalBus<TEvents extends EventMap> extends PublishableBus<TEvents, TEvents> {
    clear(): void;
    narrow<TPublishableEvents extends EventMap, TAllEvents extends EventMap>(): PublishableBus<
        TPublishableEvents,
        TAllEvents
    >;
}

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

    function reportError(error: unknown, context: EventBusReportedErrorContext): void {
        const normalized = normalizeError(error);

        if (!config.onError) {
            console.error(`[EventBus] ${context.phase} error:`, normalized);
            return;
        }

        try {
            config.onError(normalized, context);
        } catch (onErrorFailure) {
            const onErrorError = normalizeError(onErrorFailure);
            const onErrorContext: EventBusErrorContext = {
                failedContext: context,
                originalError: normalized,
                phase: "onError",
            };
            console.error("[EventBus] onError failed:", onErrorError, onErrorContext);
        }
    }

    function removeHandler(entry: RegisteredHandler): void {
        const index = handlers.indexOf(entry);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    }

    function addHandler(pattern: string, handler: Handler<unknown>, options: SubscribeOptions = {}): Subscription {
        const entry: RegisteredHandler = {
            filter: options.filter as ((envelope: Envelope) => boolean) | undefined,
            handler,
            once: options.once ?? false,
            pattern,
            priority: options.priority ?? 0,
            regex: patternToRegex(pattern),
            subscriberId: options.subscriberId ?? `sub_${++idCounter}`,
        };
        handlers.push(entry);
        handlers.sort((left, right) => left.priority - right.priority);
        return {
            subscriberId: entry.subscriberId,
            topic: entry.pattern,
            unsubscribe: () => removeHandler(entry),
        };
    }

    function passesFilter(entry: RegisteredHandler, envelope: Envelope): boolean {
        if (!entry.filter) {
            return true;
        }

        try {
            return entry.filter(envelope);
        } catch (error) {
            reportError(error, {
                envelope,
                pattern: entry.pattern,
                phase: "filter",
                subscriberId: entry.subscriberId,
            });
            return false;
        }
    }

    async function notifyHandler(entry: RegisteredHandler, envelope: Envelope): Promise<void> {
        try {
            await entry.handler(envelope);
        } catch (error) {
            reportError(error, {
                envelope,
                pattern: entry.pattern,
                phase: "handler",
                subscriberId: entry.subscriberId,
            });
        }
    }

    async function dispatch(envelope: Envelope, topic: string): Promise<void> {
        const matching = handlers.filter((entry) => entry.regex.test(topic));
        const completedOnce: RegisteredHandler[] = [];

        for (const entry of matching) {
            if (!passesFilter(entry, envelope)) {
                continue;
            }
            await notifyHandler(entry, envelope);
            if (entry.once) {
                completedOnce.push(entry);
            }
        }

        for (const entry of completedOnce) {
            removeHandler(entry);
        }
    }

    const bus: InternalBus<TEvents> = {
        clear() {
            handlers.length = 0;
        },

        history(topic) {
            if (topic === undefined) {
                return [...buffer];
            }
            const regex = patternToRegex(topic);
            return buffer.filter((envelope) => regex.test(envelope.topic));
        },

        narrow<TPublishableEvents extends EventMap, TAllEvents extends EventMap>() {
            return bus as unknown as PublishableBus<TPublishableEvents, TAllEvents>;
        },

        on(pattern, handler, options) {
            return addHandler(pattern, handler, options);
        },

        async publish(topic, payload, options = {}) {
            const source = options.source ?? "unknown";

            try {
                const envelope: Envelope = {
                    correlationId: options.correlationId,
                    id: `evt_${++idCounter}_${Date.now()}`,
                    payload,
                    source,
                    timestamp: Date.now(),
                    topic,
                };

                if (maxBuffer > 0) {
                    buffer.push(envelope);
                    if (buffer.length > maxBuffer) {
                        buffer.shift();
                    }
                }

                await dispatch(envelope, topic);
            } catch (error) {
                reportError(error, {
                    payload,
                    phase: "publish",
                    source,
                    topic,
                });
            }
        },

        subscribe(topic, handler, options) {
            return addHandler(topic, handler as Handler<unknown>, options as SubscribeOptions | undefined);
        },

        waitFor(topic, options = {}) {
            const { filter, timeout = 30_000 } = options;
            return new Promise((resolve, reject) => {
                const timer =
                    timeout > 0
                        ? setTimeout(() => {
                              subscription.unsubscribe();
                              const error = new Error(`waitFor("${topic}") timed out after ${timeout}ms`);
                              reportError(error, { phase: "waitFor", timeout, topic });
                              reject(error);
                          }, timeout)
                        : null;

                const subscriberId = `wait_${++idCounter}`;
                const subscription = addHandler(
                    topic,
                    (envelope) => {
                        if (filter) {
                            let passed = false;
                            try {
                                passed = filter(envelope as Envelope<TEvents[typeof topic]>);
                            } catch (error) {
                                reportError(error, {
                                    envelope,
                                    pattern: topic,
                                    phase: "filter",
                                    subscriberId,
                                });
                                return;
                            }
                            if (!passed) {
                                return;
                            }
                        }
                        if (timer) {
                            clearTimeout(timer);
                        }
                        resolve(envelope as Envelope<TEvents[typeof topic]>);
                    },
                    { once: true, subscriberId }
                );
            });
        },
    };

    return bus;
}
