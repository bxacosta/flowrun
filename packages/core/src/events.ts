// biome-ignore lint/suspicious/noExplicitAny: event maps need to accept arbitrary payload shapes
export type EventMap = Record<string, any>;

export type AsEventMap<T> = { [K in keyof T & string]: T[K] };

export type EventSource = "cleanup" | "container" | "flow" | "items" | "logger" | "provide" | "system" | "task";

export interface Envelope<TPayload = unknown> {
    correlationId?: string;
    id: string;
    payload: TPayload;
    source: string;
    timestamp: number;
    topic: string;
}

export interface SystemInternalEvents {
    "flow:ended": {
        duration: number;
        error?: Error;
        flowName: string;
        reason?: string;
        runId: string;
        status: "cancelled" | "failed" | "success";
    };
    "flow:paused": { flowName: string; runId: string };
    "flow:resumed": { flowName: string; runId: string };
    "flow:started": { flowName: string; runId: string };
    "node:every:ended": {
        duration: number;
        errors?: Error[];
        failedIndexes?: number[];
        flowName: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
        totalItems: number;
    };
    "node:every:started": { flowName: string; nodeName: string; runId: string; totalItems: number };
    "node:parallel:ended": {
        duration: number;
        errors?: Error[];
        flowName: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
    };
    "node:parallel:started": { flowName: string; nodeName: string; runId: string };
    "node:task:attempt:ended": {
        attempt: number;
        duration: number;
        error?: Error;
        flowName: string;
        index?: number;
        nodeName: string;
        reason?: string;
        runId: string;
        status: "failed" | "skipped" | "success";
    };
    "node:task:attempt:started": {
        attempt: number;
        flowName: string;
        index?: number;
        nodeName: string;
        runId: string;
    };
    "node:task:ended": {
        attempts: number;
        duration: number;
        error?: Error;
        flowName: string;
        index?: number;
        nodeName: string;
        reason?: string;
        runId: string;
        status: "failed" | "skipped" | "success";
    };
    "node:task:retried": {
        attempt: number;
        error: Error;
        flowName: string;
        index?: number;
        nextDelayMs: number;
        nodeName: string;
        runId: string;
    };
    "node:task:started": { flowName: string; index?: number; maxAttempts: number; nodeName: string; runId: string };
    "request:cancelled": {
        flowName: string;
        id: string;
        dedupeKey?: string;
        name: string;
        nodeName?: string;
        path: readonly string[];
        reason?: string;
        runId: string;
    };
    "request:created": {
        flowName: string;
        id: string;
        dedupeKey?: string;
        metadata?: Record<string, unknown>;
        name: string;
        nodeName?: string;
        path: readonly string[];
        payload: unknown;
        runId: string;
        timeoutAt?: number;
    };
    "request:expired": {
        flowName: string;
        id: string;
        dedupeKey?: string;
        name: string;
        nodeName?: string;
        path: readonly string[];
        runId: string;
        timeoutAt: number;
    };
    "request:responded": {
        flowName: string;
        id: string;
        dedupeKey?: string;
        name: string;
        nodeName?: string;
        path: readonly string[];
        response: unknown;
        responseMetadata?: Record<string, unknown>;
        runId: string;
    };
}

export type LogLevel = "debug" | "error" | "info" | "warn";

export interface LogEventPayload {
    data?: unknown;
    flowName: string;
    level: LogLevel;
    message: string;
    runId: string;
}

export interface SystemPublicEvents {
    log: LogEventPayload;
}

export type SystemEvents = SystemInternalEvents & SystemPublicEvents;

export type MergeAllEvents<
    TCurrentAll extends EventMap,
    TExtensionInternal extends object,
    TExtensionPublic extends object,
> = TCurrentAll & AsEventMap<TExtensionInternal> & AsEventMap<TExtensionPublic>;

export type MergePublicEvents<TCurrentPublic extends EventMap, TExtensionPublic extends object> = TCurrentPublic &
    AsEventMap<TExtensionPublic>;
