import type { RunCompletionStatus, StepStatus } from "./types.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EventBase {
    readonly flowId: string;
    readonly kind: string;
    readonly runId: string;
    readonly timestamp: Date;
}

export interface FlowStartEvent extends EventBase {
    readonly flowName: string;
    readonly kind: "flow:start";
    readonly params: Record<string, unknown>;
}

export interface FlowEndEvent extends EventBase {
    readonly cancelReason?: string;
    readonly durationMs: number;
    readonly error?: Error;
    readonly flowName: string;
    readonly kind: "flow:end";
    readonly status: RunCompletionStatus;
    readonly stopReason?: string;
}

export interface StepStartEvent extends EventBase {
    readonly attempt: number;
    readonly attempts: number;
    readonly kind: "step:start";
    readonly stepId: string;
    readonly stepName: string;
}

export interface StepRetryEvent extends EventBase {
    readonly attempt: number;
    readonly attempts: number;
    readonly delayMs: number;
    readonly error: Error;
    readonly kind: "step:retry";
    readonly stepId: string;
    readonly stepName: string;
}

export interface StepEndEvent extends EventBase {
    readonly attempt: number;
    readonly attempts: number;
    readonly durationMs: number;
    readonly error?: Error;
    readonly kind: "step:end";
    readonly status: StepStatus;
    readonly stepId: string;
    readonly stepName: string;
}

export interface LogEvent extends EventBase {
    readonly data?: Record<string, unknown>;
    readonly kind: "log";
    readonly level: LogLevel;
    readonly message: string;
    readonly stepId?: string;
    readonly stepName?: string;
}

export type EngineEvent = FlowStartEvent | FlowEndEvent | StepStartEvent | StepRetryEvent | StepEndEvent | LogEvent;
