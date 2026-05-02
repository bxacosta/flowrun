import type { SystemEvents, Envelope, ReadableBus, Subscription } from "../../src";
import { type Color, colorize } from "./helpers.ts";

// ── Formatting Helpers ───────────────────────────────────────────────

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
    return index !== undefined ? colorize("dim", `[${index}]`) : "";
}

// ── Console Subscriber ───────────────────────────────────────────────

export function subscriber<TEvents extends SystemEvents>(bus: ReadableBus<TEvents>,) {
    const subscriptions: Subscription[] = [];

    const track = <K extends keyof TEvents & string>(
        topic: K,
        handler: (envelope: Envelope<TEvents[K]>) => void,
    ): void => {
        subscriptions.push(bus.subscribe(topic, handler));
    };

    // ── Flow lifecycle ───────────────────────────────────────────────

    track("flow:start", (envelope) => {
        const prefix = formatPrefix(envelope);
        const flowName = colorize("cyan", envelope.payload.flowName);
        console.log(`${prefix} ${colorize("cyan", "FLOW START")}  ${flowName}`);
    });

    track("flow:end", (envelope) => {
        const prefix = formatPrefix(envelope);
        const status = envelope.payload.status;
        const color = FLOW_STATUS_COLORS[status] ?? "red";
        const label = colorize(color, `FLOW ${status.toUpperCase()}`);
        const duration = formatDuration(envelope.payload.duration);
        const detail =
            envelope.payload.reason ?? envelope.payload.error?.message ?? "";
        console.log(`${prefix} ${label}  ${duration}`, detail);
    });

    track("flow:paused", (envelope) => {
        const prefix = formatPrefix(envelope);
        console.log(`${prefix} ${colorize("yellow", "FLOW PAUSED")}`);
    });

    track("flow:resumed", (envelope) => {
        const prefix = formatPrefix(envelope);
        console.log(`${prefix} ${colorize("green", "FLOW RESUMED")}`);
    });

    // ── Task lifecycle ───────────────────────────────────────────────

    track("node:task:start", (envelope) => {
        const prefix = formatPrefix(envelope);
        const name = envelope.payload.nodeName;
        const index = formatNodeIndex(envelope.payload.index);
        const attempts = colorize("dim", `(1/${envelope.payload.maxAttempts})`);
        console.log(`${prefix}   ${colorize("blue", "TASK START")}  ${name}${index} ${attempts}`);
    });

    track("node:task:retry", (envelope) => {
        const prefix = formatPrefix(envelope);
        const name = envelope.payload.nodeName;
        const index = formatNodeIndex(envelope.payload.index);
        const attempt = colorize("dim", `(${envelope.payload.attempt})`);
        const nextDelay = colorize("dim", `next in ${envelope.payload.nextDelayMs}ms`);
        const error = colorize("red", envelope.payload.error.message);
        console.log(`${prefix}   ${colorize("yellow", "TASK RETRY")}  ${name}${index} ${attempt} ${nextDelay} — ${error}`,);
    });

    track("node:task:end", (envelope) => {
        const prefix = formatPrefix(envelope);
        const name = envelope.payload.nodeName;
        const index = formatNodeIndex(envelope.payload.index);
        const status = envelope.payload.status;
        const color = TASK_STATUS_COLORS[status] ?? "red";
        const label = colorize(color, `TASK ${status.toUpperCase()}`);
        const attempts = colorize("dim", `(${envelope.payload.attempts}/${envelope.payload.attempts})`);
        const duration = formatDuration(envelope.payload.duration);
        const error = envelope.payload.error?.message ?? "";
        console.log(`${prefix}   ${label}  ${name}${index} ${attempts} ${duration}`, error);
    });

    // ── Container lifecycle ──────────────────────────────────────────

    track("node:parallel:start", (envelope) => {
        const prefix = formatPrefix(envelope);
        console.log(
            `${prefix}   ${colorize("magenta", "PARALLEL START")}  ${envelope.payload.nodeName}`,
        );
    });

    track("node:parallel:end", (envelope) => {
        const prefix = formatPrefix(envelope);
        const status = envelope.payload.status;
        const color = status === "success" ? "green" : "red";
        const label = colorize(color, `PARALLEL ${status.toUpperCase()}`);
        const duration = formatDuration(envelope.payload.duration);
        console.log(`${prefix}   ${label}  ${envelope.payload.nodeName} ${duration}`);
    });

    track("node:every:start", (envelope) => {
        const prefix = formatPrefix(envelope);
        const items = colorize("dim", `(${envelope.payload.totalItems} items)`);
        console.log(`${prefix}   ${colorize("magenta", "EVERY START")}  ${envelope.payload.nodeName} ${items}`);
    });

    track("node:every:end", (envelope) => {
        const prefix = formatPrefix(envelope);
        const status = envelope.payload.status;
        const color = status === "success" ? "green" : "red";
        const label = colorize(color, `EVERY ${status.toUpperCase()}`);
        const duration = formatDuration(envelope.payload.duration);
        const failed =
            envelope.payload.failedIndexes && envelope.payload.failedIndexes.length > 0
                ? colorize("red", ` failed: [${envelope.payload.failedIndexes.join(", ")}]`)
                : "";
        console.log(`${prefix}   ${label}  ${envelope.payload.nodeName} ${duration}${failed}`,);
    });

    // ── Log events ────────────────────────────────────────────────────

    subscriptions.push(
        bus.subscribe("log", (envelope) => {
            const timestamp = formatTimestamp(envelope.timestamp);
            const runId = formatRunId(envelope.payload.runId);
            const color = LOG_LEVEL_COLORS[envelope.payload.level] ?? "white";
            const label = colorize(color, envelope.payload.level.toUpperCase().padEnd(5));
            const data = envelope.payload.data !== undefined ? colorize("dim", ` ${JSON.stringify(envelope.payload.data)}`) : "";
            console.log(`${timestamp} ${runId}     ${label}  ${envelope.payload.message}${data}`);
        }),
    );

    return {
        dispose() {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        },
    };
}
