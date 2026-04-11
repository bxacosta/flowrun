import type { InternalBus, PublishableBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";
import type { Logger } from "./logger.ts";
import type { PauseGate } from "./signal.ts";
import type { AnyFlowStateStore, TaskResult } from "./types.ts";

// ── Flow Runtime ─────────────────────────────────────────────────────

export interface FlowRuntime {
    bus: InternalBus<EventMap>;
    flowName: string;
    log: Logger;
    params: Readonly<Record<string, unknown>>;
    provided: Record<string, unknown>;
    publicBus: PublishableBus<EventMap, EventMap>;
    runId: string;
}

// ── Flow Progress ────────────────────────────────────────────────────

export interface FlowProgress {
    taskResults: TaskResult[];
}

// ── Execution Context ────────────────────────────────────────────────

export interface ExecutionContext {
    pathSegments: readonly string[];
    pauseGate: PauseGate;
    progress: FlowProgress;
    runtime: FlowRuntime;
}

// ── Base Context Builder ─────────────────────────────────────────────

function buildBaseContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    source: string
): Record<string, unknown> {
    return {
        ...runtime.provided,
        bus: runtime.publicBus,
        flowName: runtime.flowName,
        log: runtime.log,
        params: runtime.params,
        publish: (topic: string, payload: unknown, options?: { correlationId?: string; source?: string }) => {
            // biome-ignore lint/complexity/noVoid: fire-and-forget publish for user context
            void runtime.publicBus.publish(topic, payload, { source, ...options });
        },
        runId: runtime.runId,
        signal,
        state,
    };
}

// ── Flow Context Builder ─────────────────────────────────────────────

export function buildFlowContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal
): Record<string, unknown> {
    return buildBaseContext(runtime, state, signal, "flow");
}

// ── Task Context Builder ─────────────────────────────────────────────

export function buildTaskContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    nodeName: string,
    attempt: number,
    iteration?: { index: number; item: unknown }
): Record<string, unknown> {
    const context: Record<string, unknown> = {
        ...buildBaseContext(runtime, state, signal, "task"),
        attempt,
        nodeName,
    };

    if (iteration) {
        return {
            ...context,
            iteration: Object.freeze({ index: iteration.index, item: iteration.item }),
        };
    }

    return context;
}

// ── Items Context Builder ────────────────────────────────────────────

export function buildItemsContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Record<string, unknown> {
    const context = buildBaseContext(runtime, state, signal, "flow");

    if (iteration) {
        return {
            ...context,
            iteration: Object.freeze({ index: iteration.index, item: iteration.item }),
        };
    }

    return context;
}
