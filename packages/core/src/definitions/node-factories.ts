import { defaultMergeStrategy, defaultParallelMode } from "../core/constants.ts";
import type {
    FlowNode,
    GroupDefinition,
    GroupOptions,
    MergeStrategy,
    ParallelDefinition,
    ParallelOptions,
    StateOf,
    TaskContext,
    TaskDefinition,
    TaskHandler,
    TaskOptions,
} from "../core/types.ts";

export const task = <TContext extends TaskContext = TaskContext>(
    id: string,
    handler: TaskHandler<TContext>,
    options?: TaskOptions<TContext>
): TaskDefinition<TContext> => ({
    handler,
    id,
    kind: "task",
    middleware: options?.middleware ?? [],
    name: options?.name ?? id,
    onError: options?.onError,
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
});

export const group = <TContext extends TaskContext = TaskContext>(
    id: string,
    children: readonly FlowNode<TContext>[],
    options?: GroupOptions
): GroupDefinition<TContext> => ({
    children,
    id,
    kind: "group",
    name: options?.name ?? id,
});

export const parallel = <TContext extends TaskContext = TaskContext>(
    id: string,
    children: readonly FlowNode<TContext>[],
    options?: ParallelOptions<TContext>
): ParallelDefinition<TContext> => ({
    children,
    cleanupContext: options?.cleanupContext,
    concurrency: options?.concurrency,
    forkContext: options?.forkContext,
    id,
    kind: "parallel",
    merge: (options?.merge ?? defaultMergeStrategy) as MergeStrategy<StateOf<TContext>>,
    mode: options?.mode ?? defaultParallelMode,
    name: options?.name ?? id,
});
