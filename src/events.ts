import type {RunCompletionStatus, StepStatus} from "./types.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EventBase {
    readonly kind: string;
    readonly flowId: string;
    readonly runId: string;
    readonly timestamp: Date;
}

export interface FlowStartEvent extends EventBase {
    readonly kind: "flow:start";
    readonly flowName: string;
    readonly params: Record<string, unknown>;
}

export interface FlowEndEvent extends EventBase {
    readonly kind: "flow:end";
    readonly flowName: string;
    readonly status: RunCompletionStatus;
    readonly durationMs: number;
    readonly error?: Error;
    readonly stopReason?: string;
    readonly cancelReason?: string;
}

export interface StepStartEvent extends EventBase {
    readonly kind: "step:start";
    readonly stepId: string;
    readonly stepName: string;
    readonly attempt: number;
    readonly attempts: number;
}

export interface StepRetryEvent extends EventBase {
    readonly kind: "step:retry";
    readonly stepId: string;
    readonly stepName: string;
    readonly attempt: number;
    readonly attempts: number;
    readonly delayMs: number;
    readonly error: Error;
}

export interface StepEndEvent extends EventBase {
    readonly kind: "step:end";
    readonly stepId: string;
    readonly stepName: string;
    readonly attempt: number;
    readonly status: StepStatus;
    readonly attempts: number;
    readonly durationMs: number;
    readonly error?: Error;
}

export interface LogEvent extends EventBase {
    readonly kind: "log";
    readonly level: LogLevel;
    readonly message: string;
    readonly stepId?: string;
    readonly stepName?: string;
    readonly data?: Record<string, unknown>;
}

export type EngineEvent =
    | FlowStartEvent
    | FlowEndEvent
    | StepStartEvent
    | StepRetryEvent
    | StepEndEvent
    | LogEvent;
