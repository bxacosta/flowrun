import type { FlowContext, ItemsContext, TaskContext } from "./context.ts";
import type { Middleware } from "./middleware.ts";
import type {
    ContainerErrorMode,
    EveryMeta,
    Node,
    NodeDefinition,
    ParallelMeta,
    RetryConfig,
    TaskErrorMode,
} from "./node.ts";
import type { Shape, WithIteration, WithProvided } from "./shape.ts";
import type { MergeStrategy } from "./state.ts";
import type { MaybePromise } from "./utils.ts";
import { assertUniqueNodeNames } from "./validation.ts";

export interface TaskConfig<TShape extends Shape> {
    middleware?: NoInfer<Middleware<TaskContext<TShape>>>[];
    name: string;
    onError?: TaskErrorMode;
    retry?: RetryConfig;
    run: (context: TaskContext<TShape>) => MaybePromise<void>;
}

export interface ParallelOptions {
    merge?: MergeStrategy;
    onError?: ContainerErrorMode;
}

export interface ParallelResourceConfig<TShape extends Shape, TLocal extends object> {
    cleanup?: (context: ItemsContext<WithProvided<TShape, TLocal>>, meta: ParallelMeta) => MaybePromise<void>;
    provide: (context: ItemsContext<TShape>, meta: ParallelMeta) => MaybePromise<TLocal>;
}

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

export interface EveryOptions {
    concurrency?: number;
    merge?: MergeStrategy;
    onError?: ContainerErrorMode;
}

export interface EveryResourceConfig<TShape extends Shape, TItem, TLocal extends object> {
    cleanup?: (
        context: ItemsContext<WithProvided<WithIteration<TShape, TItem>, TLocal>>,
        meta: EveryMeta<TItem>
    ) => MaybePromise<void>;
    provide: (context: ItemsContext<WithIteration<TShape, TItem>>, meta: EveryMeta<TItem>) => MaybePromise<TLocal>;
}

export type EveryConfig<TShape extends Shape, TItem> = EveryOptions & {
    items: (context: ItemsContext<TShape>) => readonly TItem[];
    name: string;
    nodes: NodesSpec<WithIteration<TShape, TItem>>;
    resource?: never;
};

export type EveryConfigWithResource<TShape extends Shape, TItem, TLocal extends object> = EveryOptions & {
    items: (context: ItemsContext<TShape>) => readonly TItem[];
    name: string;
    nodes: NodesSpec<WithProvided<WithIteration<TShape, TItem>, TLocal>>;
    resource: EveryResourceConfig<TShape, TItem, TLocal>;
};

export type NodesSpec<TShape extends Shape> =
    | readonly Node<TShape>[]
    | ((nodes: NodeFactory<TShape>) => readonly Node<TShape>[]);

export interface NodeFactory<TShape extends Shape> {
    every<TItem>(config: EveryConfig<TShape, TItem>): Node<TShape>;
    every<TItem, TLocal extends object>(config: EveryConfigWithResource<TShape, TItem, TLocal>): Node<TShape>;
    parallel(config: ParallelConfig<TShape>): Node<TShape>;
    parallel<TLocal extends object>(config: ParallelConfigWithResource<TShape, TLocal>): Node<TShape>;
    task(config: TaskConfig<TShape>): Node<TShape>;
}

export interface MiddlewareConfig<TContext> {
    name: string;
    run: (context: TContext, next: () => Promise<void>) => MaybePromise<void>;
}

export function resolveNodes<TShape extends Shape>(spec: NodesSpec<TShape>): Node<TShape>[] {
    const nodes = typeof spec === "function" ? spec(createNodeFactory<TShape>()) : spec;
    return [...nodes];
}

export function buildTask<TShape extends Shape>(config: TaskConfig<TShape>): Node<TShape> {
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

export function buildEvery<TShape extends Shape, TItem>(
    config: EveryConfig<TShape, TItem> | EveryConfigWithResource<TShape, TItem, object>
): Node<TShape> {
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
        type: "every",
    };
}

export function middleware<TContext>(config: MiddlewareConfig<TContext>): Middleware<TContext> {
    return { name: config.name, run: config.run };
}

export function createNodeFactory<TShape extends Shape>(): NodeFactory<TShape> {
    return {
        every: buildEvery,
        parallel: buildParallel,
        task: buildTask,
    } as unknown as NodeFactory<TShape>;
}

export type FlowMiddleware<TShape extends Shape> = Middleware<FlowContext<TShape>>;
export type TaskMiddleware<TShape extends Shape> = Middleware<TaskContext<TShape>>;
