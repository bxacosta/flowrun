/**
 * definition/node-factory.ts — Node factories
 *
 * Layer: L3 (definition). The `task`/`parallel`/`each` builders and their config
 * types, including the typed `resource` lifecycle for containers.
 */

import { FlowEngineError } from "../core/errors.ts";
import type { MaybePromise, MergeObjects } from "../core/types.ts";
import { assertUniqueNodeNames, assertValidName } from "../core/validation.ts";
import type { Shape, WithIteration, WithProvided } from "../shape/shape.ts";
import type { MergeStrategy } from "../state/types.ts";
import type { ContainerContext, TaskContext } from "./context-types.ts";
import type { Middleware } from "./middleware.ts";
import type { EachMeta, ErrorMode, Node, NodeDefinition, ParallelMeta, ResourceOutcome, RetryConfig } from "./node.ts";

export interface TaskConfig<TShape extends Shape> {
    middleware?: NoInfer<Middleware<TaskContext<TShape>>>[];
    name: string;
    onError?: ErrorMode;
    retry?: RetryConfig;
    run: (context: TaskContext<TShape>) => MaybePromise<void>;
}

export type ContainerMeta<TItem = unknown> = EachMeta<TItem> | ParallelMeta;

export interface ResourceFactory<TContext extends object, TLocal extends object, TMeta = ContainerMeta> {
    cleanup?: (context: MergeObjects<TContext, TLocal>, meta: TMeta, outcome: ResourceOutcome) => MaybePromise<void>;
    provide: (context: TContext, meta: TMeta) => MaybePromise<TLocal>;
}

export interface ParallelOptions {
    merge?: MergeStrategy;
    onError?: ErrorMode;
}

export type ParallelResourceConfig<TShape extends Shape, TLocal extends object> = ResourceFactory<
    ContainerContext<TShape>,
    TLocal,
    ParallelMeta
>;

export type ParallelConfig<TShape extends Shape> = ParallelOptions & {
    name: string;
    nodes: NodesSpec<TShape>;
    resource?: never;
};

export type ParallelConfigWithResource<TShape extends Shape, TLocal extends object> = ParallelOptions & {
    name: string;
    nodes: NodesSpec<WithProvided<TShape, TLocal>>;
    resource: ParallelResourceConfig<TShape, TLocal>;
};

export interface EachOptions {
    concurrency?: number;
    merge?: MergeStrategy;
    onError?: ErrorMode;
}

export type EachResourceConfig<TShape extends Shape, TItem, TLocal extends object> = ResourceFactory<
    ContainerContext<WithIteration<TShape, TItem>>,
    TLocal,
    EachMeta<TItem>
>;

export type EachConfig<TShape extends Shape, TItem> = EachOptions & {
    items: (context: ContainerContext<TShape>) => MaybePromise<readonly TItem[]>;
    name: string;
    nodes: NodesSpec<WithIteration<TShape, TItem>>;
    resource?: never;
};

export type EachConfigWithResource<TShape extends Shape, TItem, TLocal extends object> = EachOptions & {
    items: (context: ContainerContext<TShape>) => MaybePromise<readonly TItem[]>;
    name: string;
    nodes: NodesSpec<WithProvided<WithIteration<TShape, TItem>, TLocal>>;
    resource: EachResourceConfig<TShape, TItem, TLocal>;
};

export type NodesSpec<TShape extends Shape> =
    | readonly Node<TShape>[]
    | ((nodes: NodeFactory<TShape>) => readonly Node<TShape>[]);

export interface NodeFactory<TShape extends Shape> {
    each<TItem>(config: EachConfig<TShape, TItem>): Node<TShape>;
    each<TItem, TLocal extends object>(config: EachConfigWithResource<TShape, TItem, TLocal>): Node<TShape>;
    parallel(config: ParallelConfig<TShape>): Node<TShape>;
    parallel<TLocal extends object>(config: ParallelConfigWithResource<TShape, TLocal>): Node<TShape>;
    task(config: TaskConfig<TShape>): Node<TShape>;
}

// ── Builders ────────────────────────────────────────────────────────

export function resolveNodes<TShape extends Shape>(spec: NodesSpec<TShape>): Node<TShape>[] {
    const nodes = typeof spec === "function" ? spec(createNodeFactory<TShape>()) : spec;
    return [...nodes];
}

export function buildTask<TShape extends Shape>(config: TaskConfig<TShape>): Node<TShape> {
    assertValidName("task", config.name);
    if (config.retry && config.retry.maxAttempts < 1) {
        throw new FlowEngineError(`task "${config.name}": retry.maxAttempts must be >= 1`);
    }
    return {
        middleware: config.middleware ?? [],
        name: config.name,
        onError: config.onError ?? "fail",
        retry: config.retry,
        run: config.run,
        type: "task",
    };
}

export function buildParallel<TShape extends Shape>(
    config: ParallelConfig<TShape> | ParallelConfigWithResource<TShape, object>
): Node<TShape> {
    assertValidName("parallel", config.name);
    type ChildShape = TShape | WithProvided<TShape, object>;
    const childNodes = resolveNodes(config.nodes as NodesSpec<ChildShape>);
    assertUniqueNodeNames(childNodes, config.name);
    return {
        merge: config.merge ?? "overwrite",
        name: config.name,
        nodes: childNodes as NodeDefinition[],
        onError: config.onError ?? "fail",
        resource: config.resource,
        type: "parallel",
    };
}

export function buildEach<TShape extends Shape, TItem>(
    config: EachConfig<TShape, TItem> | EachConfigWithResource<TShape, TItem, object>
): Node<TShape> {
    assertValidName("each", config.name);
    type ChildShape = WithIteration<TShape, TItem> | WithProvided<WithIteration<TShape, TItem>, object>;
    const childNodes = resolveNodes(config.nodes as NodesSpec<ChildShape>);
    assertUniqueNodeNames(childNodes, config.name);
    return {
        concurrency: config.concurrency ?? Number.POSITIVE_INFINITY,
        items: config.items,
        merge: config.merge ?? "overwrite",
        name: config.name,
        nodes: childNodes as NodeDefinition[],
        onError: config.onError ?? "fail",
        resource: config.resource,
        type: "each",
    };
}

export function createNodeFactory<TShape extends Shape>(): NodeFactory<TShape> {
    return {
        each: buildEach,
        parallel: buildParallel,
        task: buildTask,
    } as unknown as NodeFactory<TShape>;
}
