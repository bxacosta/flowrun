import type { AnyEventBus } from "./event-bus.ts";
import type { EventSource, LogLevel } from "./events.ts";

export interface Logger {
    debug(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
}

export interface LoggerScope {
    bus: AnyEventBus;
    flowName: string;
    iteration?: { index: number; item: unknown };
    nodeName?: string;
    path?: readonly string[];
    runId: string;
    source: EventSource;
}

export function createLogger(scope: LoggerScope): Logger {
    const write = (level: LogLevel, message: string, data?: unknown): void => {
        const payload = data === undefined ? { level, message } : { data, level, message };
        scope.bus.emit("log", payload, {
            flowName: scope.flowName,
            iteration: scope.iteration,
            nodeName: scope.nodeName,
            path: scope.path,
            runId: scope.runId,
            source: scope.source,
        });
    };

    return {
        debug: (message, data) => write("debug", message, data),
        error: (message, data) => write("error", message, data),
        info: (message, data) => write("info", message, data),
        warn: (message, data) => write("warn", message, data),
    };
}
