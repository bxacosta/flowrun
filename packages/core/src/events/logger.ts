/**
 * events/logger.ts — Scoped logger
 *
 * Layer: L2. A logger is a thin facade that emits "log" events onto the bus,
 * carrying the current flow/run/node scope.
 */

import type { IterationContext } from "../core/types.ts";
import type { EventBus } from "./bus.ts";
import { type EventSource, type LogLevel, systemEvents } from "./types.ts";

export interface Logger {
    debug(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
}

export interface LoggerScope {
    bus: EventBus;
    flowName: string;
    iteration?: IterationContext;
    nodeName?: string;
    path?: readonly string[];
    runId: string;
    source: EventSource;
}

export function createLogger(scope: LoggerScope): Logger {
    const write = (level: LogLevel, message: string, data?: unknown): void => {
        const payload = data === undefined ? { level, message } : { data, level, message };
        scope.bus.emit(systemEvents.log, payload, {
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
