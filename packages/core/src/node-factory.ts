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
import type { AnyScope, IterationScope, WithProvided } from "./scope.ts";
import type { MergeStrategy } from "./state.ts";
import type { MaybePromise } from "./utils.ts";
import { assertUniqueNodeNames } from "./validation.ts";

export interface TaskConfig<TScope extends AnyScope> {
    middleware?: NoInfer<Middleware<TaskContext<TScope>>>[];
    name: string;
    onError?: TaskErrorMode;
    retry?: RetryConfig;
    run: (context: TaskContext<TScope>) => MaybePromise<void>;
}

export interface ParallelOptions {
    merge?: MergeStrategy;
    onError?: ContainerErrorMode;
}

export interface ParallelResourceConfig<TScope extends AnyScope, TLocal extends object> {
    cleanup?: (context: ItemsContext<WithProvided<TScope, TLocal>>, meta: ParallelMeta) => MaybePromise<void>;
    provide: (context: ItemsContext<TScope>, meta: ParallelMeta) => MaybePromise<TLocal>;
}

export type ParallelConfig<TScope extends AnyScope> = ParallelOptions & {
    name: string;
    nodes: NodesSpec<TScope>;
    resource?: never;
};

export type ParallelConfigWithResource<TScope extends AnyScope, TLocal extends object> = ParallelOptions & {
    name: string;
    nodes: NodesSpec<WithProvided<TScope, TLocal>>;
    resource: ParallelResourceConfig<TScope, TLocal>;
};

export interface EveryOptions {
    concurrency?: number;
    merge?: MergeStrategy;
    onError?: ContainerErrorMode;
}

export interface EveryResourceConfig<TScope extends AnyScope, TItem, TLocal extends object> {
    cleanup?: (
        context: ItemsContext<WithProvided<IterationScope<TScope, TItem>, TLocal>>,
        meta: EveryMeta<TItem>
    ) => MaybePromise<void>;
    provide: (context: ItemsContext<IterationScope<TScope, TItem>>, meta: EveryMeta<TItem>) => MaybePromise<TLocal>;
}

export type EveryConfig<TScope extends AnyScope, TItem> = EveryOptions & {
    items: (context: ItemsContext<TScope>) => readonly TItem[];
    name: string;
    nodes: NodesSpec<IterationScope<TScope, TItem>>;
    resource?: never;
};

export type EveryConfigWithResource<TScope extends AnyScope, TItem, TLocal extends object> = EveryOptions & {
    items: (context: ItemsContext<TScope>) => readonly TItem[];
    name: string;
    nodes: NodesSpec<WithProvided<IterationScope<TScope, TItem>, TLocal>>;
    resource: EveryResourceConfig<TScope, TItem, TLocal>;
};

export type NodesSpec<TScope extends AnyScope> =
    | readonly Node<TScope>[]
    | ((nodes: NodeFactory<TScope>) => readonly Node<TScope>[]);

export interface NodeFactory<TScope extends AnyScope> {
    every<TItem>(config: EveryConfig<TScope, TItem>): Node<TScope>;
    every<TItem, TLocal extends object>(config: EveryConfigWithResource<TScope, TItem, TLocal>): Node<TScope>;
    parallel(config: ParallelConfig<TScope>): Node<TScope>;
    parallel<TLocal extends object>(config: ParallelConfigWithResource<TScope, TLocal>): Node<TScope>;
    task(config: TaskConfig<TScope>): Node<TScope>;
}

export interface MiddlewareConfig<TContext> {
    name: string;
    run: (context: TContext, next: () => Promise<void>) => MaybePromise<void>;
}

export function resolveNodes<TScope extends AnyScope>(spec: NodesSpec<TScope>): Node<TScope>[] {
    const nodes = typeof spec === "function" ? spec(createNodeFactory<TScope>()) : spec;
    return [...nodes];
}

export function buildTask<TScope extends AnyScope>(config: TaskConfig<TScope>): Node<TScope> {
    return {
        middleware: config.middleware ?? [],
        name: config.name,
        onError: config.onError ?? "fail",
        retry: config.retry,
        run: config.run,
        type: "task",
    };
}

export function buildParallel<TScope extends AnyScope>(
    config: ParallelConfig<TScope> | ParallelConfigWithResource<TScope, object>
): Node<TScope> {
    type ChildScope = TScope | WithProvided<TScope, object>;
    const childNodes = resolveNodes(config.nodes as NodesSpec<ChildScope>);
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

export function buildEvery<TScope extends AnyScope, TItem>(
    config: EveryConfig<TScope, TItem> | EveryConfigWithResource<TScope, TItem, object>
): Node<TScope> {
    type ChildScope = IterationScope<TScope, TItem> | WithProvided<IterationScope<TScope, TItem>, object>;
    const childNodes = resolveNodes(config.nodes as NodesSpec<ChildScope>);
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

export function buildMiddleware<TContext>(config: MiddlewareConfig<TContext>): Middleware<TContext> {
    return { name: config.name, run: config.run };
}

export function createNodeFactory<TScope extends AnyScope>(): NodeFactory<TScope> {
    return {
        every: buildEvery,
        parallel: buildParallel,
        task: buildTask,
    };
}

export type FlowMiddleware<TScope extends AnyScope> = Middleware<FlowContext<TScope>>;
export type TaskMiddleware<TScope extends AnyScope> = Middleware<TaskContext<TScope>>;
