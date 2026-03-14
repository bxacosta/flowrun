import type { RunCompletionStatus, StepStatus } from "./types.ts";

export interface EventMeta {
    readonly flowId: string;
    readonly runId: string;
    readonly timestamp: Date;
}

export interface EngineEvent extends EventMeta {
    readonly type: string;
}

export interface FlowStartedPayload {
    readonly flowName: string;
    readonly params: unknown;
}

export interface FlowEndedPayload {
    readonly cancelReason?: string;
    readonly durationMs: number;
    readonly error?: Error;
    readonly flowName: string;
    readonly status: RunCompletionStatus;
    readonly stopReason?: string;
}

export interface StepStartedPayload {
    readonly attempt: number;
    readonly attempts: number;
    readonly stepId: string;
    readonly stepName: string;
}

export interface StepEndedPayload {
    readonly attempt: number;
    readonly attempts: number;
    readonly durationMs: number;
    readonly error?: Error;
    readonly status: StepStatus;
    readonly stepId: string;
    readonly stepName: string;
}

export interface StepRetryingPayload {
    readonly attempt: number;
    readonly attempts: number;
    readonly delayMs: number;
    readonly error: Error;
    readonly stepId: string;
    readonly stepName: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPayload {
    readonly data?: Record<string, unknown>;
    readonly level: LogLevel;
    readonly message: string;
    readonly stepId?: string;
    readonly stepName?: string;
}

export interface UserEvents {
    log: LogPayload;
}

export interface CoreEvents extends UserEvents {
    "flow.ended": FlowEndedPayload;
    "flow.started": FlowStartedPayload;
    "step.ended": StepEndedPayload;
    "step.retrying": StepRetryingPayload;
    "step.started": StepStartedPayload;
}

export type TypedEvent<K extends string, T> = EventMeta & T & { readonly type: K };

export type FlowStartedEvent = TypedEvent<"flow.started", FlowStartedPayload>;
export type FlowEndedEvent = TypedEvent<"flow.ended", FlowEndedPayload>;
export type StepStartedEvent = TypedEvent<"step.started", StepStartedPayload>;
export type StepEndedEvent = TypedEvent<"step.ended", StepEndedPayload>;
export type StepRetryingEvent = TypedEvent<"step.retrying", StepRetryingPayload>;
export type LogEvent = TypedEvent<"log", LogPayload>;

export type CoreEvent =
    | FlowStartedEvent
    | FlowEndedEvent
    | StepStartedEvent
    | StepEndedEvent
    | StepRetryingEvent
    | LogEvent;
