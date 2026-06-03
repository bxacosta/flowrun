/**
 * engine/results.ts — Run result types
 *
 * Layer: L4 (engine). The discriminated {@link FlowResult} returned by a run and
 * the per-task {@link TaskResult} entries collected along the way.
 */

import type { IterationContext } from "../core/types.ts";

export interface TaskResult {
    attempts: number;
    durationMs: number;
    error?: Error;
    ignored: boolean;
    iteration?: IterationContext;
    nodeName: string;
    path: string;
    reason?: string;
    status: "failed" | "skipped" | "success";
}

export interface BaseFlowResult<TState extends object> {
    durationMs: number;
    flowName: string;
    runId: string;
    state: Readonly<TState>;
    tasks: readonly TaskResult[];
}

export interface SuccessFlowResult<TState extends object> extends BaseFlowResult<TState> {
    status: "success";
}

export interface FailedFlowResult<TState extends object> extends BaseFlowResult<TState> {
    error: Error;
    status: "failed";
}

export interface CancelledFlowResult<TState extends object> extends BaseFlowResult<TState> {
    reason?: string;
    status: "cancelled";
}

export type FlowResult<TState extends object> =
    | CancelledFlowResult<TState>
    | FailedFlowResult<TState>
    | SuccessFlowResult<TState>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow result for runtime orchestration
export type AnyFlowResult = FlowResult<any>;
