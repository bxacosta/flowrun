import type { EventMap, FlowInfo, Middleware, StateShape, TaskRunResult } from "../core/types.ts";
import type { RunController } from "../engine/run-controller.ts";
import type { EventBus } from "../events/event-bus.ts";
import type { FlowStateStore } from "../state/state-store.ts";

export interface NodeExecutionOutcome {
    readonly error?: Error;
    readonly stopReason?: string;
}

export interface TaskExecutionOutcome extends NodeExecutionOutcome {
    readonly status: "completed" | "failed" | "skipped";
}

export interface ExecutionContext {
    emitUserEvent(type: string, data: Record<string, unknown>): void;
    readonly eventBus: EventBus<EventMap>;
    readonly flowInfo: FlowInfo;
    readonly flowMiddleware: readonly Middleware<any>[];
    readonly params: unknown;
    readonly runController: RunController;
    readonly runId: string;
    readonly scopedContext: object;
    readonly signal: AbortSignal;
    readonly stateStore: FlowStateStore<StateShape>;
    readonly taskResults: TaskRunResult[];
}
