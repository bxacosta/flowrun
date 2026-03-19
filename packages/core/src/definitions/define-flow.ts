import { FlowEngineError } from "../core/errors.ts";
import type {
    ErasedFlowNode,
    FlowBuilderApi,
    FlowDefinition,
    FlowHooks,
    FlowNode,
    GroupOptions,
    Middleware,
    NodesRequiredContext,
    ParallelOptions,
    RetryPolicy,
    StateShape,
    TaskHandler,
    TaskOptions,
    UserEventMap,
} from "../core/types.ts";
import type { Simplify } from "../utils/type-helpers.ts";
import { group, parallel, task } from "./node-factories.ts";

// ── Validation ───────────────────────────────────────────────────────

const validateRetryPolicy = (taskId: string, retry: RetryPolicy): void => {
    if (!Number.isInteger(retry.attempts) || retry.attempts < 1) {
        throw new FlowEngineError(`Task "${taskId}" retry attempts must be an integer >= 1`);
    }

    if (retry.delayMs !== undefined && (!Number.isFinite(retry.delayMs) || retry.delayMs < 0)) {
        throw new FlowEngineError(`Task "${taskId}" retry delayMs must be a non-negative number`);
    }

    if (retry.maxDelayMs !== undefined && (!Number.isFinite(retry.maxDelayMs) || retry.maxDelayMs < 0)) {
        throw new FlowEngineError(`Task "${taskId}" retry maxDelayMs must be a non-negative number`);
    }
};

const validateNode = <
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
>(
    node: FlowNode<TParams, TState, TUserEvents, TBaseContext, object>,
    ids: Set<string>
): void => {
    if (ids.has(node.id)) {
        throw new FlowEngineError(`Duplicate node id "${node.id}"`);
    }

    ids.add(node.id);

    if (node.kind === "task") {
        if (node.timeoutMs !== undefined && (!Number.isFinite(node.timeoutMs) || node.timeoutMs <= 0)) {
            throw new FlowEngineError(`Task "${node.id}" timeoutMs must be a positive number`);
        }

        if (node.retry !== undefined) {
            validateRetryPolicy(node.id, node.retry);
        }

        return;
    }

    if (node.kind === "group") {
        if (node.children.length === 0) {
            throw new FlowEngineError(`Group "${node.id}" must contain at least one child node`);
        }

        for (const child of node.children) {
            validateNode(child, ids);
        }

        return;
    }

    if (node.children.length === 0) {
        throw new FlowEngineError(`Parallel group "${node.id}" must contain at least one child node`);
    }

    if (node.concurrency !== undefined && (!Number.isInteger(node.concurrency) || node.concurrency < 1)) {
        throw new FlowEngineError(`Parallel group "${node.id}" concurrency must be an integer > 0`);
    }

    for (const child of node.children) {
        validateNode(child, ids);
    }
};

const validateFlowDefinition = <
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
>(
    flow: FlowDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>
): void => {
    if (flow.nodes.length === 0) {
        throw new FlowEngineError(`Flow "${flow.id}" must contain at least one node`);
    }

    const ids = new Set<string>();

    for (const node of flow.nodes) {
        validateNode(node, ids);
    }
};

// ── Input types ──────────────────────────────────────────────────────

interface SharedFlowInput<
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
    TRequiredContext extends object,
> {
    readonly hooks?: FlowHooks<TParams, TState, TBaseContext, TUserEvents>;
    readonly id: string;
    readonly initialState?: TState | (() => TState);
    readonly middleware?: readonly Middleware<
        TParams,
        TState,
        Simplify<TBaseContext & TRequiredContext>,
        TUserEvents
    >[];
    readonly name?: string;
}

type FlowInputFromNodes<
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
    TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[],
> = SharedFlowInput<TParams, TState, TBaseContext, TUserEvents, NodesRequiredContext<TNodes>> & {
    readonly build?: never;
    readonly nodes: TNodes;
};

type FlowInputFromBuilder<
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
    TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[],
> = SharedFlowInput<TParams, TState, TBaseContext, TUserEvents, NodesRequiredContext<TNodes>> & {
    readonly build: (builder: FlowBuilderApi<TParams, TState, TBaseContext, TUserEvents>) => TNodes;
    readonly nodes?: never;
};

export type FlowInput<
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
    TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[],
> =
    | FlowInputFromBuilder<TParams, TState, TBaseContext, TUserEvents, TNodes>
    | FlowInputFromNodes<TParams, TState, TBaseContext, TUserEvents, TNodes>;

// ── Builder API ──────────────────────────────────────────────────────

const createBuilderApi = <
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
>(): FlowBuilderApi<TParams, TState, TBaseContext, TUserEvents> => ({
    group: <TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[]>(
        id: string,
        children: TNodes,
        options?: GroupOptions
    ) => group<TParams, TState, TBaseContext, TUserEvents, TNodes>(id, children, options),

    parallel: <TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[]>(
        id: string,
        children: TNodes,
        options?: ParallelOptions<TState, Simplify<TBaseContext & NodesRequiredContext<TNodes>>>
    ) => parallel<TParams, TState, TBaseContext, TUserEvents, TNodes>(id, children, options),

    task: <TRequiredContext extends object = {}>(
        id: string,
        handler: TaskHandler<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>,
        options?: TaskOptions<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>
    ) => task<TParams, TState, TBaseContext, TUserEvents, TRequiredContext>(id, handler, options),
});

// ── defineFlow ───────────────────────────────────────────────────────

export const defineFlow = <
    TParams,
    TState extends StateShape = {},
    TBaseContext extends object = {},
    TUserEvents extends UserEventMap = {},
    TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[] = readonly ErasedFlowNode<
        TParams,
        TState,
        TUserEvents,
        TBaseContext
    >[],
>(
    input: FlowInput<TParams, TState, TBaseContext, TUserEvents, TNodes>
): FlowDefinition<TParams, TState, TUserEvents, TBaseContext, NodesRequiredContext<TNodes>> => {
    const builderApi = createBuilderApi<TParams, TState, TBaseContext, TUserEvents>();
    const nodes = input.build !== undefined ? input.build(builderApi) : input.nodes;

    const flow: FlowDefinition<TParams, TState, TUserEvents, TBaseContext, NodesRequiredContext<TNodes>> = {
        hooks: input.hooks ?? {},
        id: input.id,
        initialState: input.initialState,
        middleware: input.middleware ?? [],
        name: input.name ?? input.id,
        nodes,
    };

    validateFlowDefinition(flow);

    return flow;
};
