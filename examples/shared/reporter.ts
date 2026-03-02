import type { EngineEvent, LogEvent, Reporter } from "../../src";

const COLORS = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
} as const;

type Color = keyof typeof COLORS;

const FLOW_STATUS_COLOR: Record<string, Color> = {
    completed: "green",
    cancelled: "yellow",
};

const STEP_STATUS_COLOR: Record<string, Color> = {
    completed: "green",
    skipped: "yellow",
};

function colorize(color: Color, text: string): string {
    return `${COLORS[color]}${text}${COLORS.reset}`;
}

function formatPrefix(event: EngineEvent): string {
    const time = colorize("dim", event.timestamp.toISOString().slice(11, 23));
    const run = colorize("dim", `[${event.runId.slice(0, 8)}]`);
    return `${time} ${run}`;
}

function formatData(data?: Record<string, unknown>): string {
    return data ? colorize("dim", JSON.stringify(data)) : "";
}

export class ConsoleReporter implements Reporter {
    report(event: EngineEvent): void {
        const prefix = formatPrefix(event);

        switch (event.kind) {
            case "flow:start":
                console.log(`${prefix} ${colorize("cyan", "FLOW START")} ${event.flowName}`, formatData(event.params));
                return;
            case "flow:end": {
                const color = FLOW_STATUS_COLOR[event.status] ?? "red";
                console.log(
                    `${prefix} ${colorize(color, `FLOW ${event.status.toUpperCase()}`)}`,
                    colorize("dim", `(${event.durationMs}ms)`),
                    event.stopReason ?? event.cancelReason ?? event.error?.message ?? ""
                );
                return;
            }
            case "step:start":
                console.log(
                    `${prefix} ${colorize("blue", "STEP START")} ${event.stepName}`,
                    colorize("dim", `${event.attempt}/${event.attempts}`)
                );
                return;
            case "step:retry":
                console.log(
                    `${prefix} ${colorize("yellow", "STEP RETRY")} ${event.stepName}`,
                    colorize("dim", `${event.attempt}/${event.attempts}`),
                    colorize("red", event.error.message)
                );
                return;
            case "step:end": {
                const color = STEP_STATUS_COLOR[event.status] ?? "red";
                console.log(
                    `${prefix} ${colorize(color, `STEP ${event.status.toUpperCase()}`)} ${event.stepName}`,
                    colorize("dim", `${event.attempt}/${event.attempts}`),
                    colorize("dim", `(${event.durationMs}ms)`),
                    event.error?.message ?? ""
                );
                return;
            }
            case "log":
                this.reportLog(prefix, event);
        }
    }

    private reportLog(prefix: string, event: LogEvent): void {
        const colors = {
            debug: "dim",
            info: "white",
            warn: "yellow",
            error: "red",
        } as const;
        const label = colorize(colors[event.level], event.level.toUpperCase().padEnd(5));
        const step = event.stepName ? colorize("dim", `[${event.stepName}]`) : "";
        console.log(`${prefix} ${step} ${label} ${event.message}`, formatData(event.data));
    }
}
