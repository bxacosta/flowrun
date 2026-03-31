import type { AnyMiddleware, FlowInfo, StateShape, TaskRunResult } from "../core/types.ts";
import type { RunController } from "../engine/run-controller.ts";
import type { AnyEventBus } from "../events/event-bus.ts";
import type { FlowStateStore } from "../state/state-store.ts";

export interface NodeExecutionOutcome {
    readonly error?: Error;
    readonly stopReason?: string;
}

export interface TaskExecutionOutcome extends NodeExecutionOutcome {
    readonly status: "completed" | "failed" | "skipped";
}

export interface ExecutionContext {
    emitUserEvent(type: string, data: object): void;
    readonly eventBus: AnyEventBus;
    readonly flowInfo: FlowInfo;
    readonly flowMiddleware: readonly AnyMiddleware[];
    readonly params: unknown;
    readonly runController: RunController;
    readonly runId: string;
    readonly scopedContext: object;
    readonly signal: AbortSignal;
    readonly stateStore: FlowStateStore<StateShape>;
    readonly taskResults: TaskRunResult[];
}
