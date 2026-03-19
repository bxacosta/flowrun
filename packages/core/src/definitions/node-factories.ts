import { defaultMergeStrategy, defaultParallelMode } from "../core/constants.ts";
import type {
    ErasedFlowNode,
    GroupDefinition,
    GroupOptions,
    MergeStrategy,
    NodesRequiredContext,
    ParallelDefinition,
    ParallelOptions,
    StateShape,
    TaskDefinition,
    TaskHandler,
    TaskOptions,
    UserEventMap,
} from "../core/types.ts";
import type { Simplify } from "../utils/type-helpers.ts";

export const task = <
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
    TRequiredContext extends object = {},
>(
    id: string,
    handler: TaskHandler<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>,
    options?: TaskOptions<TParams, TState, Simplify<TBaseContext & TRequiredContext>, TUserEvents>
): TaskDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext> => ({
    handler,
    id,
    kind: "task",
    middleware: options?.middleware ?? [],
    name: options?.name ?? id,
    onError: options?.onError,
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
});

export const group = <
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
    TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[],
>(
    id: string,
    children: TNodes,
    options?: GroupOptions
): GroupDefinition<TParams, TState, TUserEvents, TBaseContext, NodesRequiredContext<TNodes>> => ({
    children,
    id,
    kind: "group",
    name: options?.name ?? id,
});

export const parallel = <
    TParams,
    TState extends StateShape,
    TBaseContext extends object,
    TUserEvents extends UserEventMap,
    TNodes extends readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[],
>(
    id: string,
    children: TNodes,
    options?: ParallelOptions<TState, Simplify<TBaseContext & NodesRequiredContext<TNodes>>>
): ParallelDefinition<TParams, TState, TUserEvents, TBaseContext, NodesRequiredContext<TNodes>> => ({
    children,
    cleanupContext: options?.cleanupContext,
    concurrency: options?.concurrency,
    forkContext: options?.forkContext,
    id,
    kind: "parallel",
    merge: (options?.merge ?? defaultMergeStrategy) as MergeStrategy<TState>,
    mode: options?.mode ?? defaultParallelMode,
    name: options?.name ?? id,
});
