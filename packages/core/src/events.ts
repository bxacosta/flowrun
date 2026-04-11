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
        flowName: string;
        reason?: string;
        runId: string;
        status: "cancelled" | "failed" | "success";
    };
    "flow:paused": { flowName: string; runId: string };
    "flow:resumed": { flowName: string; runId: string };
    "flow:start": { flowName: string; runId: string };
    "node:every:end": {
        duration: number;
        errors?: Error[];
        failedIndexes?: number[];
        flowName: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
        totalItems: number;
    };
    "node:every:start": { flowName: string; nodeName: string; runId: string; totalItems: number };
    "node:parallel:end": {
        duration: number;
        errors?: Error[];
        flowName: string;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
    };
    "node:parallel:start": { flowName: string; nodeName: string; runId: string };
    "node:task:attempt:end": {
        attempt: number;
        duration: number;
        error?: Error;
        flowName: string;
        index?: number;
        nodeName: string;
        runId: string;
        status: "failed" | "success";
    };
    "node:task:attempt:start": {
        attempt: number;
        flowName: string;
        index?: number;
        nodeName: string;
        runId: string;
    };
    "node:task:end": {
        attempts: number;
        duration: number;
        error?: Error;
        flowName: string;
        index?: number;
        nodeName: string;
        runId: string;
        status: "failed" | "skipped" | "success";
    };
    "node:task:retry": {
        attempt: number;
        error: Error;
        flowName: string;
        index?: number;
        nextDelayMs: number;
        nodeName: string;
        runId: string;
    };
    "node:task:start": { flowName: string; index?: number; maxAttempts: number; nodeName: string; runId: string };
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

// ── Type-Level Merge Helpers ──────────────────────────────────────────

export type MergeAllEvents<
    TCurrentAll extends EventMap,
    TExtensionInternal extends object,
    TExtensionPublic extends object,
> = TCurrentAll & AsEventMap<TExtensionInternal> & AsEventMap<TExtensionPublic>;

export type MergePublicEvents<TCurrentPublic extends EventMap, TExtensionPublic extends object> = TCurrentPublic &
    AsEventMap<TExtensionPublic>;
