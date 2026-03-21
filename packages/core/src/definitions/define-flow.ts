import { FlowEngineError } from "../core/errors.ts";
import type {
    FlowBuilderApi,
    FlowDefinition,
    FlowHooks,
    FlowNode,
    GroupOptions,
    Middleware,
    ParallelOptions,
    RetryPolicy,
    StateOf,
    TaskContext,
    TaskHandler,
    TaskOptions,
} from "../core/types.ts";
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

const validateNode = (node: FlowNode<any>, ids: Set<string>): void => {
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

const validateFlowDefinition = (flow: FlowDefinition<any>): void => {
    if (flow.nodes.length === 0) {
        throw new FlowEngineError(`Flow "${flow.id}" must contain at least one node`);
    }

    const ids = new Set<string>();

    for (const node of flow.nodes) {
        validateNode(node, ids);
    }
};

// ── Input types ──────────────────────────────────────────────────────

interface FlowInputBase<TContext extends TaskContext> {
    readonly hooks?: FlowHooks<TContext>;
    readonly id: string;
    readonly initialState?: StateOf<TContext> | (() => StateOf<TContext>);
    readonly middleware?: readonly Middleware<TContext>[];
    readonly name?: string;
}

type FlowInputWithNodes<TContext extends TaskContext> = FlowInputBase<TContext> & {
    readonly build?: never;
    readonly nodes: readonly FlowNode<TContext>[];
};

type FlowInputWithBuilder<TContext extends TaskContext> = FlowInputBase<TContext> & {
    readonly build: (builder: FlowBuilderApi<TContext>) => readonly FlowNode<TContext>[];
    readonly nodes?: never;
};

export type FlowInput<TContext extends TaskContext = TaskContext> =
    | FlowInputWithBuilder<TContext>
    | FlowInputWithNodes<TContext>;

// ── Builder API ──────────────────────────────────────────────────────

const createBuilderApi = <TContext extends TaskContext>(): FlowBuilderApi<TContext> => ({
    group: (id: string, children: readonly FlowNode<TContext>[], options?: GroupOptions) =>
        group<TContext>(id, children, options),

    parallel: (id: string, children: readonly FlowNode<TContext>[], options?: ParallelOptions<TContext>) =>
        parallel<TContext>(id, children, options),

    task: (id: string, handler: TaskHandler<TContext>, options?: TaskOptions<TContext>) =>
        task<TContext>(id, handler, options),
});

// ── defineFlow ───────────────────────────────────────────────────────

export const defineFlow = <TContext extends TaskContext = TaskContext>(
    input: FlowInput<TContext>
): FlowDefinition<TContext> => {
    const builderApi = createBuilderApi<TContext>();
    const nodes = input.build !== undefined ? input.build(builderApi) : input.nodes;

    const flow: FlowDefinition<TContext> = {
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
