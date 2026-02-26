import type {LogLevel} from "./events.ts";
import type {Reporter} from "./reporter.ts";

export interface Logger {
    debug(message: string, data?: Record<string, unknown>): void;

    info(message: string, data?: Record<string, unknown>): void;

    warn(message: string, data?: Record<string, unknown>): void;

    error(message: string, data?: Record<string, unknown>): void;
}

export interface LoggerScope {
    flowId: string;
    runId: string;
    stepId?: string;
    stepName?: string;
}

export function createLogger(reporter: Reporter, scope: LoggerScope): Logger {
    const emit =
        (level: LogLevel) =>
            (message: string, data?: Record<string, unknown>): void => {
                reporter.report({
                    kind: "log",
                    level,
                    flowId: scope.flowId,
                    runId: scope.runId,
                    stepId: scope.stepId,
                    stepName: scope.stepName,
                    timestamp: new Date(),
                    message,
                    data,
                });
            };

    return {
        debug: emit("debug"),
        info: emit("info"),
        warn: emit("warn"),
        error: emit("error"),
    };
}
