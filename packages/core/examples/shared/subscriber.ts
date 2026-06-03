import {
    type AnyEventToken,
    type EventEnvelope,
    type EventSubscriber,
    type PayloadOf,
    type Subscription,
    systemEvents,
} from "@flowrun/core";
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

const TASK_STATE_LABELS: Record<string, string> = {
    failed: "fail",
    skipped: "skip",
    success: "ok",
};

const LOG_LEVEL_COLORS: Record<string, Color> = {
    debug: "dim",
    error: "red",
    info: "white",
    warn: "yellow",
};

// Column widths keep the type/state tags aligned within a sibling group. Tree
// depth shifts the whole row right, so columns align per-level, not globally.
const TYPE_WIDTH = 4;
const STATE_WIDTH = 9;

function formatTimestamp(timestamp: number): string {
    return colorize("dim", new Date(timestamp).toISOString().slice(11, 23));
}

function formatRunId(runId: string): string {
    return colorize("dim", runId.slice(0, 8));
}

function formatDuration(durationMs: number): string {
    return colorize("dim", `${Math.round(durationMs)}ms`);
}

// Jitter makes nextDelayMs a float; round it so retries read cleanly.
function formatDelay(delayMs: number): string {
    return `${Math.round(delayMs)}ms`;
}

function formatNodeIndex(index?: number): string {
    return index === undefined ? "" : colorize("dim", `[${index}]`);
}

// Tree gutter from the node path: one lane per ancestor, then a branch. Run and
// flow envelopes have no path (depth 0) and sit flush as the roots.
function gutter(event: EventEnvelope): string {
    const depth = event.path?.length ?? 0;
    if (depth <= 0) {
        return "";
    }
    return colorize("dim", `${"│  ".repeat(depth - 1)}├─ `);
}

// Pad the raw text BEFORE colorizing - padEnd would otherwise count the ANSI
// escape codes and misalign every coloured cell.
function cell(color: Color, text: string, width: number): string {
    return colorize(color, text.padEnd(width));
}

// Assembles one row as a single string so empty trailing fields never leak the
// stray space that console.log(template, "") would add.
function row(event: EventEnvelope, type: string, state: string, stateColor: Color, node: string, meta = ""): string {
    const prefix = `${formatTimestamp(event.timestamp)} ${formatRunId(event.runId)}`;
    const typeCell = cell("dim", type, TYPE_WIDTH);
    const stateCell = cell(stateColor, state, STATE_WIDTH);
    const tail = meta ? ` ${meta}` : "";
    return `${prefix} ${gutter(event)}${typeCell} ${stateCell} ${node}${tail}`;
}

function joinMeta(...parts: (string | undefined | false)[]): string {
    return parts.filter(Boolean).join(colorize("dim", " · "));
}

export function subscriber(events: EventSubscriber) {
    const subscriptions: Subscription[] = [];
    // task:started carries maxAttempts; task:ended/retried only carry the count
    // so far. Remember the ceiling per node path to render a truthful "n/max".
    const maxAttempts = new Map<string, number>();

    const attemptKey = (event: EventEnvelope): string =>
        `${event.runId}:${event.path?.join("/") ?? event.nodeName ?? ""}`;

    const track = <T extends AnyEventToken>(token: T, handler: (event: EventEnvelope<PayloadOf<T>>) => void): void => {
        subscriptions.push(events.on(token, handler));
    };

    // Two nested envelopes wrap every execution:
    //   run:*   spans the WHOLE run, including extension setup and teardown.
    //   flow:*  spans only the node + middleware pipeline (inside the run).
    // A run can therefore fail during extension setup before any flow:* fires.
    track(systemEvents.run.started, (event) => {
        console.log(row(event, "RUN", "start", "cyan", colorize("cyan", event.flowName)));
    });

    track(systemEvents.run.ended, (event) => {
        const { status } = event.payload;
        const detail = event.payload.reason ?? event.payload.error?.message;
        const meta = joinMeta(formatDuration(event.payload.durationMs), detail);
        console.log(
            row(event, "RUN", status, FLOW_STATUS_COLORS[status] ?? "red", colorize("cyan", event.flowName), meta)
        );
    });

    track(systemEvents.flow.started, (event) => {
        console.log(row(event, "FLOW", "start", "cyan", colorize("cyan", event.flowName)));
    });

    track(systemEvents.flow.ended, (event) => {
        const { status } = event.payload;
        const detail = event.payload.reason ?? event.payload.error?.message;
        const meta = joinMeta(formatDuration(event.payload.durationMs), detail);
        console.log(
            row(event, "FLOW", status, FLOW_STATUS_COLORS[status] ?? "red", colorize("cyan", event.flowName), meta)
        );
    });

    track(systemEvents.flow.paused, (event) => {
        console.log(row(event, "FLOW", "pause", "yellow", colorize("cyan", event.flowName)));
    });

    track(systemEvents.flow.resumed, (event) => {
        console.log(row(event, "FLOW", "resume", "green", colorize("cyan", event.flowName)));
    });

    track(systemEvents.node.task.started, (event) => {
        maxAttempts.set(attemptKey(event), event.payload.maxAttempts);
        const node = `${event.nodeName}${formatNodeIndex(event.iteration?.index)}`;
        const meta = event.payload.maxAttempts > 1 ? colorize("dim", `attempt 1/${event.payload.maxAttempts}`) : "";
        console.log(row(event, "TASK", "start", "blue", node, meta));
    });

    track(systemEvents.node.task.retried, (event) => {
        const node = `${event.nodeName}${formatNodeIndex(event.iteration?.index)}`;
        const max = maxAttempts.get(attemptKey(event));
        const meta = joinMeta(
            colorize("dim", max ? `${event.payload.attempt}/${max}` : `attempt ${event.payload.attempt}`),
            colorize("dim", `retry in ${formatDelay(event.payload.nextDelayMs)}`),
            colorize("red", event.payload.error.message)
        );
        console.log(row(event, "TASK", "retry", "yellow", node, meta));
    });

    track(systemEvents.node.task.ended, (event) => {
        const key = attemptKey(event);
        const max = maxAttempts.get(key) ?? event.payload.attempts;
        maxAttempts.delete(key);
        const node = `${event.nodeName}${formatNodeIndex(event.iteration?.index)}`;
        const { status } = event.payload;
        const state = TASK_STATE_LABELS[status] ?? status;
        const attempts = max > 1 ? colorize("dim", `${event.payload.attempts}/${max}`) : "";
        const detail = event.payload.reason ?? event.payload.error?.message;
        const meta = joinMeta(
            attempts,
            formatDuration(event.payload.durationMs),
            event.payload.ignored && colorize("dim", "ignored"),
            detail
        );
        console.log(row(event, "TASK", state, TASK_STATUS_COLORS[status] ?? "red", node, meta));
    });

    track(systemEvents.node.parallel.started, (event) => {
        console.log(row(event, "PAR", "start", "magenta", event.nodeName ?? ""));
    });

    track(systemEvents.node.parallel.ended, (event) => {
        const { status } = event.payload;
        const meta = formatDuration(event.payload.durationMs);
        console.log(row(event, "PAR", status, FLOW_STATUS_COLORS[status] ?? "red", event.nodeName ?? "", meta));
    });

    track(systemEvents.node.each.started, (event) => {
        const meta = colorize("dim", `${event.payload.totalItems} items`);
        console.log(row(event, "EACH", "start", "magenta", event.nodeName ?? "", meta));
    });

    track(systemEvents.node.each.ended, (event) => {
        const { status } = event.payload;
        const failed =
            event.payload.failedIndexes && event.payload.failedIndexes.length > 0
                ? colorize("red", `failed [${event.payload.failedIndexes.join(", ")}]`)
                : "";
        const meta = joinMeta(formatDuration(event.payload.durationMs), failed);
        console.log(row(event, "EACH", status, FLOW_STATUS_COLORS[status] ?? "red", event.nodeName ?? "", meta));
    });

    track(systemEvents.request.created, (event) => {
        const meta = colorize("dim", `id=${event.payload.id.slice(0, 8)}`);
        console.log(row(event, "REQ", "open", "cyan", event.payload.name, meta));
    });

    track(systemEvents.request.resolved, (event) => {
        const meta = colorize("dim", `id=${event.payload.id.slice(0, 8)}`);
        console.log(row(event, "REQ", "answer", "green", event.payload.name, meta));
    });

    track(systemEvents.request.cancelled, (event) => {
        console.log(row(event, "REQ", "cancel", "yellow", event.payload.name, event.payload.reason ?? ""));
    });

    track(systemEvents.request.expired, (event) => {
        console.log(row(event, "REQ", "expired", "red", event.payload.name));
    });

    track(systemEvents.log, (event) => {
        const level = event.payload.level;
        const data = event.payload.data === undefined ? "" : colorize("dim", JSON.stringify(event.payload.data));
        console.log(row(event, "LOG", level, LOG_LEVEL_COLORS[level] ?? "white", event.payload.message, data));
    });

    return {
        dispose() {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        },
    };
}
