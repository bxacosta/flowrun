import { FlowEngineError } from "./errors.ts";
import type {
    FlowBuilder,
    FlowDefinition,
    FlowDefinitionInput,
    FlowNode,
    ParallelNode,
    ParallelOptions,
    SequenceNode,
    SequenceOptions,
    StateShape,
    StepHandler,
    StepNode,
    StepOptions,
} from "./types.ts";

export function step<TParams, TState extends StateShape>(
    id: string,
    run: StepHandler<TParams, TState>,
    options: StepOptions<TParams, TState> = {}
): StepNode<TParams, TState> {
    return {
        kind: "step",
        id,
        name: options.name ?? id,
        run,
        timeoutMs: options.timeoutMs,
        retry: options.retry,
        onError: options.onError,
        use: [...(options.use ?? [])],
    };
}

export function sequence<TParams, TState extends StateShape>(
    id: string,
    nodes: FlowNode<TParams, TState>[],
    options: SequenceOptions = {}
): SequenceNode<TParams, TState> {
    return {
        kind: "sequence",
        id,
        name: options.name ?? id,
        nodes: [...nodes],
    };
}

export function parallel<TParams, TState extends StateShape>(
    id: string,
    nodes: FlowNode<TParams, TState>[],
    options: ParallelOptions<TState> = {}
): ParallelNode<TParams, TState> {
    if (options.concurrency !== undefined && options.concurrency <= 0) {
        throw new FlowEngineError(`parallel("${id}") requires concurrency > 0 when provided`);
    }

    return {
        kind: "parallel",
        id,
        name: options.name ?? id,
        nodes: [...nodes],
        concurrency: options.concurrency,
        mode: options.mode ?? "fail-fast",
        merge: {
            strategy: options.merge?.strategy ?? "strict",
            resolver: options.merge?.resolver,
        },
    };
}

export function createFlowBuilder<TParams, TState extends StateShape>(): FlowBuilder<TParams, TState> {
    return {
        step: (id, run, options) => step<TParams, TState>(id, run, options),
        sequence: (id, nodes, options) => sequence<TParams, TState>(id, nodes, options),
        parallel: (id, nodes, options) => parallel<TParams, TState>(id, nodes, options),
    };
}

export function defineFlow<TParams, TState extends StateShape>(
    input: FlowDefinitionInput<TParams, TState>
): FlowDefinition<TParams, TState> {
    const builder = createFlowBuilder<TParams, TState>();
    const steps = input.steps ?? input.build?.(builder);

    if (!steps || steps.length === 0) {
        throw new FlowEngineError(`Flow "${input.id}" must declare at least one node`);
    }

    return {
        id: input.id,
        name: input.name ?? input.id,
        initialState: input.initialState,
        middleware: [...(input.middleware ?? [])],
        steps: [...steps],
        onStart: input.onStart,
        onSuccess: input.onSuccess,
        onFailure: input.onFailure,
        onComplete: input.onComplete,
    };
}
