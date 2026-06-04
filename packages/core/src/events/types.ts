/**
 * events/types.ts — Event system core
 *
 * Layer: L0. The event token (the typed, portable handle every event is keyed
 * by), the `event()` factory, the built-in `systemEvents` catalog, event
 * envelopes, the scoped emit signature, and the subscriber surface.
 */

import type { IterationContext } from "../core/types.ts";
import { assertValidTopicKey } from "../core/validation.ts";

export type EventSource = "runtime" | `extension:${string}` | `flow:${string}`;

export type LogLevel = "debug" | "info" | "warn" | "error";

// ── Token ───────────────────────────────────────────────────────────

export interface EventToken<TPayload = undefined, TTopic extends string = string> {
    readonly _payload?: TPayload;
    readonly topic: TTopic;
    readonly type: "event";
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased token for runtime normalization
export type AnyEventToken = EventToken<any, string>;

export type PayloadOf<TToken> = TToken extends EventToken<infer TPayload, string> ? TPayload : never;

export function event<TPayload = undefined, const TTopic extends string = string>(
    topic: TTopic
): EventToken<TPayload, TTopic> {
    assertValidTopicKey(topic);
    const token: EventToken<TPayload, TTopic> = { topic, type: "event" };
    return Object.freeze(token);
}

// ── Built-in system events ──────────────────────────────────────────

export const systemEvents = {
    run: {
        started: event("run:started"),
        ended: event<{
            durationMs: number;
            error?: Error;
            reason?: string;
            status: "cancelled" | "failed" | "success";
        }>("run:ended"),
    },
    flow: {
        started: event("flow:started"),
        ended: event<{
            durationMs: number;
            error?: Error;
            reason?: string;
            status: "cancelled" | "failed" | "success";
        }>("flow:ended"),
        paused: event("flow:paused"),
        resumed: event("flow:resumed"),
    },
    node: {
        task: {
            started: event<{ maxAttempts: number }>("node:task:started"),
            ended: event<{
                attempts: number;
                durationMs: number;
                error?: Error;
                ignored: boolean;
                reason?: string;
                status: "failed" | "skipped" | "success";
            }>("node:task:ended"),
            retried: event<{ attempt: number; error: Error; nextDelayMs: number }>("node:task:retried"),
            attempt: {
                started: event<{ attempt: number }>("node:task:attempt:started"),
                ended: event<{
                    attempt: number;
                    durationMs: number;
                    error?: Error;
                    reason?: string;
                    status: "failed" | "skipped" | "success";
                }>("node:task:attempt:ended"),
            },
        },
        parallel: {
            started: event("node:parallel:started"),
            ended: event<{ durationMs: number; errors?: Error[]; status: "failed" | "success" }>("node:parallel:ended"),
        },
        each: {
            started: event<{ totalItems: number }>("node:each:started"),
            ended: event<{
                durationMs: number;
                errors?: Error[];
                failedIndexes?: number[];
                status: "failed" | "success";
                totalItems: number;
            }>("node:each:ended"),
        },
    },
    request: {
        created: event<{
            expiresAt?: number;
            id: string;
            idempotencyKey?: string;
            metadata?: Record<string, unknown>;
            name: string;
            payload: unknown;
        }>("request:created"),
        resolved: event<{
            id: string;
            idempotencyKey?: string;
            name: string;
            response: unknown;
            responseMetadata?: Record<string, unknown>;
        }>("request:resolved"),
        cancelled: event<{ id: string; idempotencyKey?: string; name: string; reason?: string }>("request:cancelled"),
        expired: event<{ expiresAt: number; id: string; idempotencyKey?: string; name: string }>("request:expired"),
    },
    log: event<{ data?: unknown; level: LogLevel; message: string }>("log"),
};

// ── Envelope ────────────────────────────────────────────────────────

export interface EventEnvelope<TPayload = unknown> {
    readonly correlationId?: string;
    readonly flowName: string;
    readonly id: string;
    readonly iteration?: IterationContext;
    readonly nodeName?: string;
    readonly path?: readonly string[];

    readonly payload: TPayload;

    readonly runId: string;
    readonly source: EventSource;
    readonly timestamp: number;
    readonly topic: string;
}

export interface EmitOptions {
    correlationId?: string;
}

/**
 * Emits an event for one of the tokens in scope. Fire-and-forget: returns `void`
 * and schedules delivery on a later microtask, so handlers have not run when this
 * returns — do not `await` it expecting ordering or completion guarantees.
 * (`history()` is updated synchronously; handlers are not.)
 */
export type EmitFn<TToken extends AnyEventToken> = <T extends TToken>(
    token: T,
    ...args: [PayloadOf<T>] extends [undefined]
        ? [payload?: undefined, options?: EmitOptions]
        : [payload: PayloadOf<T>, options?: EmitOptions]
) => void;

// ── Subscriber surface ──────────────────────────────────────────────

export interface Subscription {
    readonly name: string;
    readonly topic: string;
    unsubscribe(): void;
}

export interface OnOptions<TPayload = unknown> {
    filter?: (event: EventEnvelope<TPayload>) => boolean;
    name?: string;
    once?: boolean;
    priority?: number;
}

export interface WaitForOptions<TPayload = unknown> {
    filter?: (event: EventEnvelope<TPayload>) => boolean;
    signal?: AbortSignal;
    timeout?: number;
}

/**
 * Subscribe by token for a fully typed payload, or by string pattern (`*`, `**`)
 * for cross-cutting matches whose payload is `unknown`.
 */
export interface EventSubscriber {
    history<T extends AnyEventToken>(token: T): readonly EventEnvelope<PayloadOf<T>>[];
    history(pattern?: string): readonly EventEnvelope[];
    on<T extends AnyEventToken>(
        token: T,
        handler: (event: EventEnvelope<PayloadOf<T>>) => void | Promise<void>,
        options?: OnOptions<PayloadOf<T>>
    ): Subscription;
    on(pattern: string, handler: (event: EventEnvelope) => void | Promise<void>, options?: OnOptions): Subscription;
    waitFor<T extends AnyEventToken>(
        token: T,
        options?: WaitForOptions<PayloadOf<T>>
    ): Promise<EventEnvelope<PayloadOf<T>>>;
    waitFor(pattern: string, options?: WaitForOptions): Promise<EventEnvelope>;
}
