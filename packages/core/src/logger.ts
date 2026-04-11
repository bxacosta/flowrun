import type { InternalBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";

// ── Logger ────────────────────────────────────────────────────────────

export interface Logger {
    debug(message: string, data?: unknown): void;

    error(message: string, data?: unknown): void;

    info(message: string, data?: unknown): void;

    warn(message: string, data?: unknown): void;
}

export function buildLogger(flowName: string, runId: string, bus: InternalBus<EventMap>): Logger {
    return {
        debug(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowName, level: "debug", message, runId }, { source: "system" });
        },
        error(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowName, level: "error", message, runId }, { source: "system" });
        },
        info(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowName, level: "info", message, runId }, { source: "system" });
        },
        warn(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log", { data, flowName, level: "warn", message, runId }, { source: "system" });
        },
    };
}
