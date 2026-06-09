import { type EmitFn, event } from "@flowrun/core";

import type { BrowserSession } from "../../contracts/provider.ts";
import type { StorageProvider } from "../../contracts/storage.ts";

export type TraceMode = "off" | "on" | "on-failure" | "retain-on-failure";

export type TraceReason = "always" | "on-failure" | "retained";

export interface TracingExtensionConfig {
    mode: TraceMode;
    screenshots?: boolean;
    snapshots?: boolean;
    sources?: boolean;
    storageKey?: (context: { flowName: string; runId: string }) => string;
}

export interface TracingRequiredContext {
    session: BrowserSession;
    storage: StorageProvider;
}

export const tracingEvents = {
    saved: event<{ key: string; reason: TraceReason; size: number }>("tracing:saved"),
} as const;

export type TracingEvent = (typeof tracingEvents)[keyof typeof tracingEvents];

export type TracingEmit = EmitFn<TracingEvent>;

// No WithTracing transformer: tracing adds no provided context and emits only from its own setup.
