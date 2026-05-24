import type { EventMap, PublishableBus, Shape, WithEvents } from "@flowrun/core";

import type { BrowserSession } from "../../contracts/provider.ts";
import type { StorageProvider } from "../../contracts/storage.ts";

export const TRACING_EVENT_SOURCE = "tracing";

export type TraceMode = "off" | "on" | "on-failure" | "retain-on-failure";

export type TraceReason = "always" | "on-failure" | "retained";

export interface TracingExtensionConfig {
    mode: TraceMode;
    screenshots?: boolean;
    snapshots?: boolean;
    sources?: boolean;
    storageKey?: (context: { runId: string; flowName: string }) => string;
}

export interface TracingRequiredContext {
    session: BrowserSession;
    storage: StorageProvider;
}

export interface TracingEventPayloads {
    "tracing:saved": { key: string; size: number; reason: TraceReason };
}

export type TracingBus = PublishableBus<TracingEventPayloads, EventMap>;

export type WithTracing<TShape extends Shape = Shape> = WithEvents<TShape, TracingEventPayloads>;
