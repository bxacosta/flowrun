import type {
    ErasedFlowNode,
    FlowDefinition,
    GroupDefinition,
    GroupOptions,
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
import { defineFlow, type FlowInput } from "./define-flow.ts";
import { group as createGroup, parallel as createParallel, task as createTask } from "./node-factories.ts";

export interface FlowKit<TBaseContext extends object, TBaseEvents extends UserEventMap> {
    defineFlow<
        TParams,
        TState extends StateShape = {},
        TFlowEvents extends UserEventMap = {},
        TNodes extends readonly ErasedFlowNode<
            TParams,
            TState,
            Simplify<TBaseEvents & TFlowEvents>,
            TBaseContext
        >[] = readonly ErasedFlowNode<TParams, TState, Simplify<TBaseEvents & TFlowEvents>, TBaseContext>[],
    >(
        input: FlowInput<TParams, TState, TBaseContext, Simplify<TBaseEvents & TFlowEvents>, TNodes>
    ): FlowDefinition<TParams, TState, Simplify<TBaseEvents & TFlowEvents>, TBaseContext, NodesRequiredContext<TNodes>>;

    group<
        TParams,
        TState extends StateShape,
        TFlowEvents extends UserEventMap,
        TNodes extends readonly ErasedFlowNode<TParams, TState, Simplify<TBaseEvents & TFlowEvents>, TBaseContext>[],
    >(
        id: string,
        children: TNodes,
        options?: GroupOptions
    ): GroupDefinition<
        TParams,
        TState,
        Simplify<TBaseEvents & TFlowEvents>,
        TBaseContext,
        NodesRequiredContext<TNodes>
    >;

    parallel<
        TParams,
        TState extends StateShape,
        TFlowEvents extends UserEventMap,
        TNodes extends readonly ErasedFlowNode<TParams, TState, Simplify<TBaseEvents & TFlowEvents>, TBaseContext>[],
    >(
        id: string,
        children: TNodes,
        options?: ParallelOptions<TState, Simplify<TBaseContext & NodesRequiredContext<TNodes>>>
    ): ParallelDefinition<
        TParams,
        TState,
        Simplify<TBaseEvents & TFlowEvents>,
        TBaseContext,
        NodesRequiredContext<TNodes>
    >;

    task<TParams, TState extends StateShape, TFlowEvents extends UserEventMap, TRequiredContext extends object = {}>(
        id: string,
        handler: TaskHandler<
            TParams,
            TState,
            Simplify<TBaseContext & TRequiredContext>,
            Simplify<TBaseEvents & TFlowEvents>
        >,
        options?: TaskOptions<
            TParams,
            TState,
            Simplify<TBaseContext & TRequiredContext>,
            Simplify<TBaseEvents & TFlowEvents>
        >
    ): TaskDefinition<TParams, TState, Simplify<TBaseEvents & TFlowEvents>, TBaseContext, TRequiredContext>;
}

export const createFlowKit = <TBaseContext extends object = {}, TBaseEvents extends UserEventMap = {}>(): FlowKit<
    TBaseContext,
    TBaseEvents
> =>
    ({
        defineFlow: (input) => defineFlow(input),

        group: (id, children, options) => createGroup(id, children, options),

        parallel: (id, children, options) => createParallel(id, children, options),

        task: (id, handler, options) => createTask(id, handler, options),
    }) as FlowKit<TBaseContext, TBaseEvents>;
