import type { EventSubscriber, FlowEvent, RuntimeEvents, Subscription } from "@flowrun/core";
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

function formatPrefix(event: FlowEvent): string {
    return `${formatTimestamp(event.timestamp)} ${formatRunId(event.runId)}`;
}

function formatDuration(durationMs: number): string {
    return colorize("dim", `(${durationMs}ms)`);
}

function formatNodeIndex(index?: number): string {
    return index === undefined ? "" : colorize("dim", `[${index}]`);
}

export function subscriber<TEvents extends RuntimeEvents>(events: EventSubscriber<TEvents>) {
    const subscriptions: Subscription[] = [];

    const track = <K extends keyof RuntimeEvents & string>(
        topic: K,
        handler: (event: FlowEvent<RuntimeEvents[K]>) => void
    ): void => {
        subscriptions.push((events as EventSubscriber<RuntimeEvents>).on(topic, handler));
    };

    track("run:started", (event) => {
        const prefix = formatPrefix(event);
        const flowName = colorize("cyan", event.flowName);
        console.log(`${prefix} ${colorize("cyan", "RUN START ")}  ${flowName}`);
    });

    track("run:ended", (event) => {
        const prefix = formatPrefix(event);
        const status = event.payload.status;
        const color = FLOW_STATUS_COLORS[status] ?? "red";
        const label = colorize(color, `RUN ${status.toUpperCase()}`);
        const duration = formatDuration(event.payload.durationMs);
        const detail = event.payload.reason ?? event.payload.error?.message ?? "";
        console.log(`${prefix} ${label}  ${duration}`, detail);
    });

    track("flow:started", (event) => {
        const prefix = formatPrefix(event);
        const flowName = colorize("cyan", event.flowName);
        console.log(`${prefix} ${colorize("cyan", "FLOW START")}  ${flowName}`);
    });

    track("flow:ended", (event) => {
        const prefix = formatPrefix(event);
        const status = event.payload.status;
        const color = FLOW_STATUS_COLORS[status] ?? "red";
        const label = colorize(color, `FLOW ${status.toUpperCase()}`);
        const duration = formatDuration(event.payload.durationMs);
        const detail = event.payload.reason ?? event.payload.error?.message ?? "";
        console.log(`${prefix} ${label}  ${duration}`, detail);
    });

    track("flow:paused", (event) => {
        console.log(`${formatPrefix(event)} ${colorize("yellow", "FLOW PAUSED")}`);
    });

    track("flow:resumed", (event) => {
        console.log(`${formatPrefix(event)} ${colorize("green", "FLOW RESUMED")}`);
    });

    track("node:task:started", (event) => {
        const prefix = formatPrefix(event);
        const index = formatNodeIndex(event.iteration?.index);
        const attempts = colorize("dim", `(1/${event.payload.maxAttempts})`);
        console.log(`${prefix}   ${colorize("blue", "TASK START")}  ${event.nodeName}${index} ${attempts}`);
    });

    track("node:task:retried", (event) => {
        const prefix = formatPrefix(event);
        const index = formatNodeIndex(event.iteration?.index);
        const attempt = colorize("dim", `(${event.payload.attempt})`);
        const nextDelay = colorize("dim", `next in ${event.payload.nextDelayMs}ms`);
        const error = colorize("red", event.payload.error.message);
        console.log(
            `${prefix}   ${colorize("yellow", "TASK RETRY")}  ${event.nodeName}${index} ${attempt} ${nextDelay} - ${error}`
        );
    });

    track("node:task:ended", (event) => {
        const prefix = formatPrefix(event);
        const index = formatNodeIndex(event.iteration?.index);
        const status = event.payload.status;
        const color = TASK_STATUS_COLORS[status] ?? "red";
        const label = colorize(color, `TASK ${status.toUpperCase()}`);
        const attempts = colorize("dim", `(${event.payload.attempts}/${event.payload.attempts})`);
        const duration = formatDuration(event.payload.durationMs);
        const ignored = event.payload.ignored ? colorize("dim", " (ignored)") : "";
        const error = event.payload.error?.message ?? "";
        console.log(`${prefix}   ${label}  ${event.nodeName}${index} ${attempts} ${duration}${ignored}`, error);
    });

    track("node:parallel:started", (event) => {
        console.log(`${formatPrefix(event)}   ${colorize("magenta", "PARALLEL START")}  ${event.nodeName}`);
    });

    track("node:parallel:ended", (event) => {
        const status = event.payload.status;
        const color = status === "success" ? "green" : "red";
        const label = colorize(color, `PARALLEL ${status.toUpperCase()}`);
        console.log(`${formatPrefix(event)}   ${label}  ${event.nodeName} ${formatDuration(event.payload.durationMs)}`);
    });

    track("node:each:started", (event) => {
        const items = colorize("dim", `(${event.payload.totalItems} items)`);
        console.log(`${formatPrefix(event)}   ${colorize("magenta", "EACH START")}  ${event.nodeName} ${items}`);
    });

    track("node:each:ended", (event) => {
        const status = event.payload.status;
        const color = status === "success" ? "green" : "red";
        const label = colorize(color, `EACH ${status.toUpperCase()}`);
        const failed =
            event.payload.failedIndexes && event.payload.failedIndexes.length > 0
                ? colorize("red", ` failed: [${event.payload.failedIndexes.join(", ")}]`)
                : "";
        console.log(
            `${formatPrefix(event)}   ${label}  ${event.nodeName} ${formatDuration(event.payload.durationMs)}${failed}`
        );
    });

    track("request:created", (event) => {
        const prefix = formatPrefix(event);
        const label = colorize("cyan", "REQUEST CREATED");
        const id = colorize("dim", `id=${event.payload.id.slice(0, 8)}`);
        console.log(`${prefix}   ${label}  ${event.payload.name} ${id}`);
    });

    track("request:responded", (event) => {
        const prefix = formatPrefix(event);
        const label = colorize("green", "REQUEST RESPONDED");
        const id = colorize("dim", `id=${event.payload.id.slice(0, 8)}`);
        console.log(`${prefix}   ${label}  ${event.payload.name} ${id}`);
    });

    track("request:cancelled", (event) => {
        const prefix = formatPrefix(event);
        const label = colorize("yellow", "REQUEST CANCELLED");
        const reason = event.payload.reason ? colorize("dim", ` (${event.payload.reason})`) : "";
        console.log(`${prefix}   ${label}  ${event.payload.name}${reason}`);
    });

    track("request:timeout", (event) => {
        const prefix = formatPrefix(event);
        const label = colorize("red", "REQUEST TIMEOUT");
        console.log(`${prefix}   ${label}  ${event.payload.name}`);
    });

    track("log", (event) => {
        const timestamp = formatTimestamp(event.timestamp);
        const runId = formatRunId(event.runId);
        const color = LOG_LEVEL_COLORS[event.payload.level] ?? "white";
        const label = colorize(color, event.payload.level.toUpperCase().padEnd(5));
        const data = event.payload.data === undefined ? "" : colorize("dim", ` ${JSON.stringify(event.payload.data)}`);
        console.log(`${timestamp} ${runId}     ${label}  ${event.payload.message}${data}`);
    });

    return {
        dispose() {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        },
    };
}
