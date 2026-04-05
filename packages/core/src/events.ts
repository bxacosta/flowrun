// ── Primitives ────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: EventMap must accept any payload type to serve as an open generic constraint
export type EventMap = Record<string, any>;
export type AsEventMap<T> = { [K in keyof T & string]: T[K] };

// ── Envelope ──────────────────────────────────────────────────────────

export interface Envelope<TPayload = unknown> {
    correlationId?: string;
    id: string;
    payload: TPayload;
    source: string;
    timestamp: number;
    topic: string;
}

// ── System Events ─────────────────────────────────────────────────────

export interface SystemInternalEvents {
    "flow:end": {
        duration: number;
        error?: Error;
        flowId: string;
        reason?: string;
        runId: string;
        status: "cancelled" | "failed" | "success";
    };
    "flow:paused": { flowId: string; runId: string };
    "flow:resumed": { flowId: string; runId: string };
    "flow:start": { flowId: string; runId: string };
    "node:every:end": {
        duration: number;
        errors?: Error[];
        failedIndexes?: number[];
        flowId: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
        totalItems: number;
    };
    "node:every:start": { flowId: string; nodeName: string; runId: string; totalItems: number };
    "node:parallel:end": {
        duration: number;
        errors?: Error[];
        flowId: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
    };
    "node:parallel:start": { flowId: string; nodeName: string; runId: string };
    "node:task:attempt:end": {
        attempt: number;
        duration: number;
        error?: Error;
        flowId: string;
        index?: number;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
    };
    "node:task:attempt:start": {
        attempt: number;
        flowId: string;
        index?: number;
        nodeName: string;
        runId: string;
    };
    "node:task:end": {
        attempts: number;
        duration: number;
        error?: Error;
        flowId: string;
        index?: number;
        nodeName: string;
        runId: string;
        status: "failed" | "skipped" | "success";
    };
    "node:task:retry": {
        attempt: number;
        error: Error;
        flowId: string;
        index?: number;
        nextDelayMs: number;
        nodeName: string;
        runId: string;
    };
    "node:task:start": { flowId: string; index?: number; maxAttempts: number; nodeName: string; runId: string };
}

export type LogLevel = "debug" | "error" | "info" | "warn";

export interface LogEventPayload {
    data?: unknown;
    flowId: string;
    level: LogLevel;
    message: string;
    runId: string;
}

export interface SystemPublicEvents {
    log: LogEventPayload;
}

export type SystemEvents = SystemInternalEvents & SystemPublicEvents;

// ── Type-Level Merge Helpers ──────────────────────────────────────────

export type MergeAllEvents<
    TCurrentAll extends EventMap,
    TExtensionInternal extends object,
    TExtensionPublic extends object,
> = TCurrentAll & AsEventMap<TExtensionInternal> & AsEventMap<TExtensionPublic>;

export type MergePublicEvents<TCurrentPublic extends EventMap, TExtensionPublic extends object> = TCurrentPublic &
    AsEventMap<TExtensionPublic>;
