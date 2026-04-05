import type { InternalBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";

// ── Logger ────────────────────────────────────────────────────────────

export interface Logger {
    debug(message: string, data?: unknown): void;

    error(message: string, data?: unknown): void;

    info(message: string, data?: unknown): void;

    warn(message: string, data?: unknown): void;
}

export function buildLogger(flowId: string, runId: string, bus: InternalBus<EventMap>): Logger {
    return {
        debug(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowId, level: "debug", message, runId }, { source: "system" });
        },
        error(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowId, level: "error", message, runId }, { source: "system" });
        },
        info(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowId, level: "info", message, runId }, { source: "system" });
        },
        warn(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowId, level: "warn", message, runId }, { source: "system" });
        },
    };
}
