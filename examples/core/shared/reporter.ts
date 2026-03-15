import type { EventMeta, EventSubscriber } from "@flowrun/core";

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

function formatPrefix(meta: EventMeta): string {
    const time = colorize("dim", meta.timestamp.toISOString().slice(11, 23));
    const run = colorize("dim", `[${meta.runId.slice(0, 8)}]`);
    return `${time} ${run}`;
}

function formatData(data?: Record<string, unknown>): string {
    return data ? colorize("dim", JSON.stringify(data)) : "";
}

export function consoleSubscriber(events: EventSubscriber): void {
    events.on("flow.started", (data) => {
        const prefix = formatPrefix(data);
        console.log(`${prefix} ${colorize("cyan", "FLOW START")} ${data.flowName}`);
    });

    events.on("flow.ended", (data) => {
        const prefix = formatPrefix(data);
        const color = FLOW_STATUS_COLOR[data.status] ?? "red";
        console.log(
            `${prefix} ${colorize(color, `FLOW ${data.status.toUpperCase()}`)}`,
            colorize("dim", `(${data.durationMs}ms)`),
            data.stopReason ?? data.cancelReason ?? data.error?.message ?? ""
        );
    });

    events.on("step.started", (data) => {
        const prefix = formatPrefix(data);
        console.log(
            `${prefix} ${colorize("blue", "STEP START")} ${data.stepName}`,
            colorize("dim", `${data.attempt}/${data.attempts}`)
        );
    });

    events.on("step.retrying", (data) => {
        const prefix = formatPrefix(data);
        console.log(
            `${prefix} ${colorize("yellow", "STEP RETRY")} ${data.stepName}`,
            colorize("dim", `${data.attempt}/${data.attempts}`),
            colorize("red", data.error.message)
        );
    });

    events.on("step.ended", (data) => {
        const prefix = formatPrefix(data);
        const color = STEP_STATUS_COLOR[data.status] ?? "red";
        console.log(
            `${prefix} ${colorize(color, `STEP ${data.status.toUpperCase()}`)} ${data.stepName}`,
            colorize("dim", `${data.attempt}/${data.attempts}`),
            colorize("dim", `(${data.durationMs}ms)`),
            data.error?.message ?? ""
        );
    });

    events.on("log", (data) => {
        const prefix = formatPrefix(data);
        const colors = { debug: "dim", info: "white", warn: "yellow", error: "red" } as const;
        const label = colorize(colors[data.level], data.level.toUpperCase().padEnd(5));
        const step = data.stepName ? colorize("dim", `[${data.stepName}]`) : "";
        console.log(`${prefix} ${step} ${label} ${data.message}`, formatData(data.data));
    });
}
