import type {
    EventMap,
    FlowInfo,
    Middleware,
    StateShape,
    TaskRunResult,
    UserEmitEventMap,
    UserEventMap,
} from "../core/types.ts";
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

export interface ExecutionContext<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
> {
    emitUserEvent<TType extends keyof UserEmitEventMap<TUserEvents> & string>(
        type: TType,
        data: UserEmitEventMap<TUserEvents>[TType]
    ): void;
    readonly eventBus: EventBus<EventMap>;
    readonly flowInfo: FlowInfo;
    readonly flowMiddleware: readonly Middleware<TParams, TState, TBaseContext, TUserEvents>[];
    readonly params: TParams;
    readonly runController: RunController;
    readonly runId: string;
    readonly scopedContext: TBaseContext;
    readonly signal: AbortSignal;
    readonly stateStore: FlowStateStore<TState>;
    readonly taskResults: TaskRunResult[];
}
