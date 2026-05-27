// biome-ignore lint/suspicious/noExplicitAny: event maps need to accept arbitrary payload shapes
export type EventMap = Record<string, any>;

export type AsEventMap<T> = { [K in keyof T & string]: T[K] };

export type EventSource = "runtime" | `extension:${string}` | `flow:${string}`;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface FlowEvent<TPayload = unknown> {
    readonly correlationId?: string;
    readonly flowName: string;
    readonly id: string;
    readonly iteration?: { readonly index: number; readonly item: unknown };
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

export type EventEmitter<TEvents extends EventMap> = <K extends keyof TEvents & string>(
    topic: K,
    ...args: [TEvents[K]] extends [undefined]
        ? [payload?: undefined, options?: EmitOptions]
        : [payload: TEvents[K], options?: EmitOptions]
) => void;

export interface Subscription {
    readonly name: string;
    readonly topic: string;
    unsubscribe(): void;
}

export interface OnOptions<TPayload = unknown> {
    filter?: (event: FlowEvent<TPayload>) => boolean;
    name?: string;
    once?: boolean;
    priority?: number;
}

export interface WaitForOptions<TPayload = unknown> {
    filter?: (event: FlowEvent<TPayload>) => boolean;
    signal?: AbortSignal;
    timeout?: number;
}

export interface EventStream<TEvents extends EventMap> {
    history(pattern?: string): readonly FlowEvent[];
    on<K extends keyof TEvents & string>(
        topic: K,
        handler: (event: FlowEvent<TEvents[K]>) => void | Promise<void>,
        options?: OnOptions<TEvents[K]>
    ): Subscription;
    on(
        pattern: string,
        handler: (event: FlowEvent<unknown>) => void | Promise<void>,
        options?: OnOptions<unknown>
    ): Subscription;
    waitFor<K extends keyof TEvents & string>(
        topic: K,
        options?: WaitForOptions<TEvents[K]>
    ): Promise<FlowEvent<TEvents[K]>>;
}

export interface RuntimeEvents {
    "flow:ended": {
        durationMs: number;
        error?: Error;
        reason?: string;
        status: "cancelled" | "failed" | "success";
    };
    "flow:paused": undefined;
    "flow:resumed": undefined;
    "flow:started": undefined;

    log: {
        data?: unknown;
        level: LogLevel;
        message: string;
    };

    "node:every:ended": {
        durationMs: number;
        errors?: Error[];
        failedIndexes?: number[];
        status: "failed" | "success";
        totalItems: number;
    };
    "node:every:started": { totalItems: number };

    "node:parallel:ended": {
        durationMs: number;
        errors?: Error[];
        status: "failed" | "success";
    };
    "node:parallel:started": undefined;

    "node:task:attempt:ended": {
        attempt: number;
        durationMs: number;
        error?: Error;
        reason?: string;
        status: "failed" | "skipped" | "success";
    };
    "node:task:attempt:started": { attempt: number };
    "node:task:ended": {
        attempts: number;
        durationMs: number;
        error?: Error;
        reason?: string;
        status: "failed" | "skipped" | "success";
    };
    "node:task:retried": {
        attempt: number;
        error: Error;
        nextDelayMs: number;
    };
    "node:task:started": { maxAttempts: number };

    "request:cancelled": {
        id: string;
        idempotencyKey?: string;
        name: string;
        reason?: string;
    };
    "request:created": {
        id: string;
        idempotencyKey?: string;
        metadata?: Record<string, unknown>;
        name: string;
        payload: unknown;
        timeoutAt?: number;
    };
    "request:responded": {
        id: string;
        idempotencyKey?: string;
        name: string;
        response: unknown;
        responseMetadata?: Record<string, unknown>;
    };
    "request:timeout": {
        id: string;
        idempotencyKey?: string;
        name: string;
        timeoutAt: number;
    };

    "run:ended": {
        durationMs: number;
        error?: Error;
        reason?: string;
        status: "cancelled" | "failed" | "success";
    };
    "run:started": undefined;
}
