import type { Envelope, ReadableBus, Subscription, SystemEvents } from "../../src";
import { type Color, colorize } from "./helpers.ts";

const FLOW_STATUS_COLORS: Record<string, Color> = {
    cancelled: "yellow",
    failed: "red",
    success: "green",
};

const TASK_STATUS_COLORS: Record<string, Color> = {
    failed: "red",
    skipped: "yellow",
    success: "green",
};

const LOG_LEVEL_COLORS: Record<string, Color> = {
    debug: "dim",
    error: "red",
    info: "white",
    warn: "yellow",
};

function formatTimestamp(timestamp: number): string {
    return colorize("dim", new Date(timestamp).toISOString().slice(11, 23));
}

function formatRunId(runId: string): string {
    return colorize("dim", `[${runId.slice(0, 8)}]`);
}

function formatPrefix(envelope: Envelope<{ runId: string }>): string {
    return `${formatTimestamp(envelope.timestamp)} ${formatRunId(envelope.payload.runId)}`;
}

function formatDuration(durationMs: number): string {
    return colorize("dim", `(${durationMs}ms)`);
}

function formatNodeIndex(index?: number): string {
    return index === undefined ? "" : colorize("dim", `[${index}]`);
}

export function subscriber<TEvents extends SystemEvents>(bus: ReadableBus<TEvents>) {
    const subscriptions: Subscription[] = [];

    const track = <K extends keyof TEvents & string>(
        topic: K,
        handler: (envelope: Envelope<TEvents[K]>) => void
    ): void => {
        subscriptions.push(bus.subscribe(topic, handler));
    };

    track("flow:started", (envelope) => {
        const prefix = formatPrefix(envelope);
        const flowName = colorize("cyan", envelope.payload.flowName);
        console.log(`${prefix} ${colorize("cyan", "FLOW START")}  ${flowName}`);
    });

    track("flow:ended", (envelope) => {
        const prefix = formatPrefix(envelope);
        const status = envelope.payload.status;
        const color = FLOW_STATUS_COLORS[status] ?? "red";
        const label = colorize(color, `FLOW ${status.toUpperCase()}`);
        const duration = formatDuration(envelope.payload.duration);
        const detail = envelope.payload.reason ?? envelope.payload.error?.message ?? "";
        console.log(`${prefix} ${label}  ${duration}`, detail);
    });

    track("flow:paused", (envelope) => {
        console.log(`${formatPrefix(envelope)} ${colorize("yellow", "FLOW PAUSED")}`);
    });

    track("flow:resumed", (envelope) => {
        console.log(`${formatPrefix(envelope)} ${colorize("green", "FLOW RESUMED")}`);
    });

    track("node:task:started", (envelope) => {
        const prefix = formatPrefix(envelope);
        const index = formatNodeIndex(envelope.payload.index);
        const attempts = colorize("dim", `(1/${envelope.payload.maxAttempts})`);
        console.log(`${prefix}   ${colorize("blue", "TASK START")}  ${envelope.payload.nodeName}${index} ${attempts}`);
    });

    track("node:task:retried", (envelope) => {
        const prefix = formatPrefix(envelope);
        const index = formatNodeIndex(envelope.payload.index);
        const attempt = colorize("dim", `(${envelope.payload.attempt})`);
        const nextDelay = colorize("dim", `next in ${envelope.payload.nextDelayMs}ms`);
        const error = colorize("red", envelope.payload.error.message);
        console.log(
            `${prefix}   ${colorize("yellow", "TASK RETRY")}  ${envelope.payload.nodeName}${index} ${attempt} ${nextDelay} - ${error}`
        );
    });

    track("node:task:ended", (envelope) => {
        const prefix = formatPrefix(envelope);
        const index = formatNodeIndex(envelope.payload.index);
        const status = envelope.payload.status;
        const color = TASK_STATUS_COLORS[status] ?? "red";
        const label = colorize(color, `TASK ${status.toUpperCase()}`);
        const attempts = colorize("dim", `(${envelope.payload.attempts}/${envelope.payload.attempts})`);
        const duration = formatDuration(envelope.payload.duration);
        const error = envelope.payload.error?.message ?? "";
        console.log(`${prefix}   ${label}  ${envelope.payload.nodeName}${index} ${attempts} ${duration}`, error);
    });

    track("node:parallel:started", (envelope) => {
        console.log(
            `${formatPrefix(envelope)}   ${colorize("magenta", "PARALLEL START")}  ${envelope.payload.nodeName}`
        );
    });

    track("node:parallel:ended", (envelope) => {
        const status = envelope.payload.status;
        const color = status === "success" ? "green" : "red";
        const label = colorize(color, `PARALLEL ${status.toUpperCase()}`);
        console.log(
            `${formatPrefix(envelope)}   ${label}  ${envelope.payload.nodeName} ${formatDuration(envelope.payload.duration)}`
        );
    });

    track("node:every:started", (envelope) => {
        const items = colorize("dim", `(${envelope.payload.totalItems} items)`);
        console.log(
            `${formatPrefix(envelope)}   ${colorize("magenta", "EVERY START")}  ${envelope.payload.nodeName} ${items}`
        );
    });

    track("node:every:ended", (envelope) => {
        const status = envelope.payload.status;
        const color = status === "success" ? "green" : "red";
        const label = colorize(color, `EVERY ${status.toUpperCase()}`);
        const failed =
            envelope.payload.failedIndexes && envelope.payload.failedIndexes.length > 0
                ? colorize("red", ` failed: [${envelope.payload.failedIndexes.join(", ")}]`)
                : "";
        console.log(
            `${formatPrefix(envelope)}   ${label}  ${envelope.payload.nodeName} ${formatDuration(envelope.payload.duration)}${failed}`
        );
    });

    track("request:created", (envelope) => {
        const prefix = formatPrefix(envelope);
        const label = colorize("cyan", "REQUEST CREATED");
        const id = colorize("dim", `id=${envelope.payload.id.slice(0, 8)}`);
        console.log(`${prefix}   ${label}  ${envelope.payload.name} ${id}`);
    });

    track("request:responded", (envelope) => {
        const prefix = formatPrefix(envelope);
        const label = colorize("green", "REQUEST RESPONDED");
        const id = colorize("dim", `id=${envelope.payload.id.slice(0, 8)}`);
        console.log(`${prefix}   ${label}  ${envelope.payload.name} ${id}`);
    });

    track("request:cancelled", (envelope) => {
        const prefix = formatPrefix(envelope);
        const label = colorize("yellow", "REQUEST CANCELLED");
        const reason = envelope.payload.reason ? colorize("dim", ` (${envelope.payload.reason})`) : "";
        console.log(`${prefix}   ${label}  ${envelope.payload.name}${reason}`);
    });

    track("request:expired", (envelope) => {
        const prefix = formatPrefix(envelope);
        const label = colorize("red", "REQUEST EXPIRED");
        console.log(`${prefix}   ${label}  ${envelope.payload.name}`);
    });

    subscriptions.push(
        bus.subscribe("log", (envelope) => {
            const timestamp = formatTimestamp(envelope.timestamp);
            const runId = formatRunId(envelope.payload.runId);
            const color = LOG_LEVEL_COLORS[envelope.payload.level] ?? "white";
            const label = colorize(color, envelope.payload.level.toUpperCase().padEnd(5));
            const data =
                envelope.payload.data === undefined ? "" : colorize("dim", ` ${JSON.stringify(envelope.payload.data)}`);
            console.log(`${timestamp} ${runId}     ${label}  ${envelope.payload.message}${data}`);
        })
    );

    return {
        dispose() {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        },
    };
}
