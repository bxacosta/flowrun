import type { FlowContext, FlowMiddlewareOf, ItemsContext, TaskContext, TaskMiddlewareOf } from "./context.ts";
import type {
    AnyExtensionDefinition,
    AnyExtensionProvide,
    EventDefinitions,
    ExtensionConfig,
    ExtensionDefinition,
    ExtensionInternalEvents,
    ExtensionProvided,
    ExtensionPublicEvents,
    ExtensionResource,
    ExtractInternalEvents,
    ExtractPublicEvents,
} from "./extension.ts";
import type { AnyFlowDefinition, FlowDefinition } from "./flow-runner.ts";
import type { Middleware, MiddlewareRun } from "./middleware.ts";
import type { ModuleConfig, ModuleDefinition } from "./module.ts";
import type {
    ContainerErrorMode,
    EveryMeta,
    Node,
    NodeDefinition,
    ParallelMeta,
    RetryConfig,
    TaskErrorMode,
} from "./node.ts";
import type { RequestConfig, RequestDefinition } from "./request.ts";
import { defineRequest } from "./request.ts";
import type { AnyScope, IterationScope, Scope, ScopeContract, ScopeFromContract, WithProvided } from "./scope.ts";
import type { MergeStrategy } from "./state.ts";
import type { EmptyObject, MaybePromise, Simplify } from "./utils.ts";
import { assertUniqueNodeNames } from "./validation.ts";

type RootScope<TParams extends object, TState extends object> = Scope<EmptyObject, TParams, TState>;

type UnionToIntersection<TUnion> = (TUnion extends unknown ? (value: TUnion) => void : never) extends (
    value: infer TIntersection
) => void
    ? TIntersection
    : never;

type MergeExtensionProvided<TExtensions extends readonly AnyExtensionDefinition[]> = Simplify<
    UnionToIntersection<ExtensionProvided<TExtensions[number]>>
>;

type MergeExtensionInternalEvents<TExtensions extends readonly AnyExtensionDefinition[]> = Simplify<
    UnionToIntersection<ExtensionInternalEvents<TExtensions[number]>>
>;

type MergeExtensionPublicEvents<TExtensions extends readonly AnyExtensionDefinition[]> = Simplify<
    UnionToIntersection<ExtensionPublicEvents<TExtensions[number]>>
>;

export interface TaskConfig<TScope extends AnyScope> {
    middleware?: NoInfer<
        TaskMiddlewareOf<
            TScope["_provided"],
            TScope["_params"],
            TScope["_state"],
            TScope["_publicEvents"],
            TScope["_allEvents"],
            TScope["_iteration"]
        >
    >[];
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

type FlowStateFieldOf<TParams extends object, TState extends object> = keyof TState extends never
    ? { state?: (params: Readonly<TParams>) => TState }
    : { state: (params: Readonly<TParams>) => TState };

export type FlowConfig<TScope extends AnyScope> = {
    middleware?: NoInfer<
        FlowMiddlewareOf<
            TScope["_provided"],
            TScope["_params"],
            TScope["_state"],
            TScope["_publicEvents"],
            TScope["_allEvents"]
        >
    >[];
    name: string;
    nodes: NodesSpec<TScope>;
} & FlowStateFieldOf<TScope["_params"], TScope["_state"]>;

export interface MiddlewareConfig<TContext> {
    name: string;
    run: MiddlewareRun<TContext>;
}

export interface ScopedDefine<TScope extends AnyScope> {
    every<TItem>(config: EveryConfig<TScope, TItem>): Node<TScope>;
    every<TItem, TLocal extends object>(config: EveryConfigWithResource<TScope, TItem, TLocal>): Node<TScope>;
    flow(config: FlowConfig<TScope>): FlowDefinition<TScope>;
    flowMiddleware(config: MiddlewareConfig<FlowContext<TScope>>): Middleware<FlowContext<TScope>>;
    parallel(config: ParallelConfig<TScope>): Node<TScope>;
    parallel<TLocal extends object>(config: ParallelConfigWithResource<TScope, TLocal>): Node<TScope>;
    task(config: TaskConfig<TScope>): Node<TScope>;
    taskMiddleware(config: MiddlewareConfig<TaskContext<TScope>>): Middleware<TaskContext<TScope>>;
}

function resolveNodes<TScope extends AnyScope>(
    spec: readonly Node<TScope>[] | ((nodes: NodeFactory<TScope>) => readonly Node<TScope>[])
): Node<TScope>[] {
    const nodes = typeof spec === "function" ? spec(createNodeFactory<TScope>()) : spec;
    return [...nodes];
}

function defineTask<TScope extends AnyScope>(config: TaskConfig<TScope>): Node<TScope> {
    return {
        middleware: config.middleware ?? [],
        name: config.name,
        onError: config.onError ?? "fail",
        retry: config.retry,
        run: config.run,
        type: "task",
    };
}

function defineParallel<TScope extends AnyScope>(
    config: ParallelConfig<TScope> | ParallelConfigWithResource<TScope, object>
): Node<TScope> {
    type ChildScope = TScope | WithProvided<TScope, object>;
    const childNodes = resolveNodes(
        config.nodes as readonly Node<ChildScope>[] | ((nodes: NodeFactory<ChildScope>) => readonly Node<ChildScope>[])
    );
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

function defineEvery<TScope extends AnyScope, TItem>(
    config: EveryConfig<TScope, TItem> | EveryConfigWithResource<TScope, TItem, object>
): Node<TScope> {
    type ChildScope = IterationScope<TScope, TItem> | WithProvided<IterationScope<TScope, TItem>, object>;
    const childNodes = resolveNodes(
        config.nodes as readonly Node<ChildScope>[] | ((nodes: NodeFactory<ChildScope>) => readonly Node<ChildScope>[])
    );
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

function defineMiddleware<TContext>(config: MiddlewareConfig<TContext>): Middleware<TContext> {
    return { name: config.name, run: config.run };
}

function defineFlow<TScope extends AnyScope>(config: FlowConfig<TScope>): FlowDefinition<TScope> {
    const nodes = resolveNodes(config.nodes);
    assertUniqueNodeNames(nodes, config.name);
    return {
        kind: "flow",
        middleware: config.middleware ?? [],
        name: config.name,
        nodes,
        state: "state" in config ? config.state : undefined,
    };
}

function defineExtension<TDefinitions extends EventDefinitions, TProvided extends object>(
    config: ExtensionConfig<TDefinitions, TProvided>
): ExtensionDefinition<TProvided, ExtractInternalEvents<TDefinitions>, ExtractPublicEvents<TDefinitions>> {
    const resource: ExtensionResource = {
        provide: config.resource.provide as AnyExtensionProvide,
    };
    return {
        kind: "extension",
        name: config.name,
        resource,
    };
}

function defineModule<
    const TExtensions extends readonly AnyExtensionDefinition[] = readonly [],
    const TFlows extends readonly AnyFlowDefinition[] = readonly [],
>(
    config: ModuleConfig<TExtensions, TFlows>
): ModuleDefinition<
    MergeExtensionProvided<TExtensions>,
    MergeExtensionInternalEvents<TExtensions>,
    MergeExtensionPublicEvents<TExtensions>
> {
    return {
        extensions: config.extensions ?? [],
        flows: config.flows ?? [],
        kind: "module",
        name: config.name,
    };
}

function createNodeFactory<TScope extends AnyScope>(): NodeFactory<TScope> {
    return {
        every: defineEvery,
        parallel: defineParallel,
        task: defineTask,
    };
}

function createScopedDefine<TScope extends AnyScope>(): ScopedDefine<TScope> {
    return {
        every: defineEvery,
        flow: defineFlow,
        flowMiddleware: defineMiddleware,
        parallel: defineParallel,
        task: defineTask,
        taskMiddleware: defineMiddleware,
    };
}

function scope<TContract extends ScopeContract = EmptyObject>(): ScopedDefine<ScopeFromContract<TContract>> {
    return createScopedDefine<ScopeFromContract<TContract>>();
}

function flow<TParams extends object = EmptyObject, TState extends object = EmptyObject>(
    config: FlowConfig<RootScope<TParams, TState>>
): FlowDefinition<RootScope<TParams, TState>> {
    return defineFlow(config);
}

function flowMiddleware(config: MiddlewareConfig<FlowContext>): Middleware<FlowContext> {
    return defineMiddleware(config);
}

function taskMiddleware(config: MiddlewareConfig<TaskContext>): Middleware<TaskContext> {
    return defineMiddleware(config);
}

function request<TPayload, TResponse>(
    config: RequestConfig<TPayload, TResponse>
): RequestDefinition<TPayload, TResponse> {
    return defineRequest(config);
}

export const define = {
    extension: defineExtension,
    flow,
    flowMiddleware,
    module: defineModule,
    request,
    scope,
    taskMiddleware,
} as const;
