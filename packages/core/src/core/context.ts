import { FlowStopSignal } from "./errors.ts";
import type { Reporter } from "./reporter.ts";
import type { FlowContext, StateShape, StateStore, StepContext, StepInfo } from "./types.ts";

export interface RuntimeContextConfig<TParams, TState extends StateShape> {
    flowId: string;
    flowName: string;
    params: TParams;
    reporter: Reporter;
    runId: string;
    signal: AbortSignal;
    state: StateStore<TState>;
}

export function createFlowContext<TParams, TState extends StateShape>(
    config: RuntimeContextConfig<TParams, TState>
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
        emit(type, data) {
            const event = {
                type,
                flowId: config.flowId,
                runId: config.runId,
                timestamp: new Date(),
                ...data,
            };
            config.reporter.report(event);
        },
        stop(reason?: string): never {
            throw new FlowStopSignal(reason);
        },
    };
}

export function createStepContext<TParams, TState extends StateShape>(
    base: FlowContext<TParams, TState>,
    step: StepInfo,
    attempt: number,
    signal: AbortSignal
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
    state: StateStore<TState>,
    signal: AbortSignal
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
