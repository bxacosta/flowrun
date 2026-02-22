import {FlowStopSignal} from "./errors.ts";
import type {Reporter} from "./reporter.ts";
import type {FlowContext, StateShape, StateStore, StepContext, StepInfo} from "./types.ts";

export interface RuntimeContextConfig<
    TParams,
    TState extends StateShape,
> {
    flowId: string;
    flowName: string;
    runId: string;
    params: TParams;
    state: StateStore<TState>;
    reporter: Reporter;
    signal: AbortSignal;
}

export function createFlowContext<TParams, TState extends StateShape>(
    config: RuntimeContextConfig<TParams, TState>,
): FlowContext<TParams, TState> {
    return {
        flow: {
            id: config.flowId,
            name: config.flowName,
        },
        runId: config.runId,
        params: config.params,
        state: config.state,
        signal: config.signal,
        stop(reason?: string): never {
            throw new FlowStopSignal(reason);
        },
    };
}

export function createStepContext<TParams, TState extends StateShape>(
    base: FlowContext<TParams, TState>,
    reporter: Reporter,
    step: StepInfo,
    attempt: number,
    signal: AbortSignal,
): StepContext<TParams, TState> {
    return {
        ...base,
        signal,
        step,
        attempt,
    };
}

export function createBranchFlowContext<TParams, TState extends StateShape>(
    base: FlowContext<TParams, TState>,
    reporter: Reporter,
    state: StateStore<TState>,
    signal: AbortSignal,
): FlowContext<TParams, TState> {
    return {
        ...base,
        state,
        signal,
        stop(reason?: string): never {
            throw new FlowStopSignal(reason);
        },
    };
}
