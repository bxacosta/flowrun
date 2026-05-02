import type { InternalBus } from "./event-bus.ts";
import type { EventMap, LogLevel } from "./events.ts";

export interface Logger {
    debug(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
}

export function createLogger(flowName: string, runId: string, bus: InternalBus<EventMap>): Logger {
    const write = (level: LogLevel, message: string, data?: unknown): void => {
        bus.publish("log", { data, flowName, level, message, runId }, { source: "logger" });
    };

    return {
        debug: (message, data) => write("debug", message, data),
        error: (message, data) => write("error", message, data),
        info: (message, data) => write("info", message, data),
        warn: (message, data) => write("warn", message, data),
    };
}
