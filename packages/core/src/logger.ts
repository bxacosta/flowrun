import type { InternalBus } from "./event-bus.ts";
import type { EventMap, Logger } from "./types.ts";

export function buildLogger(flowId: string, runId: string, bus: InternalBus<EventMap>): Logger {
    return {
        debug(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log:debug", { data, flowId, message, runId }, { source: "system" });
        },
        error(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log:error", { data, flowId, message, runId }, { source: "system" });
        },
        info(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log:info", { data, flowId, message, runId }, { source: "system" });
        },
        warn(message, data) {
            // biome-ignore lint/complexity/noVoid: fire-and-forget log event
            void bus.publish("log:warn", { data, flowId, message, runId }, { source: "system" });
        },
    };
}
