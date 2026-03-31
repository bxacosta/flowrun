import type {
    EventMap,
    FlowDefinition,
    FlowNode,
    GroupDefinition,
    GroupOptions,
    ParallelDefinition,
    ParallelOptions,
    StateShape,
    TaskContext,
    TaskDefinition,
    TaskHandler,
    TaskOptions,
} from "../core/types.ts";
import { defineFlow, type FlowInput } from "./define-flow.ts";
import { group as createGroup, parallel as createParallel, task as createTask } from "./node-factories.ts";

export interface FlowKit<TExtension extends object = object, TUserEvents extends EventMap = EventMap> {
    defineFlow<TContext extends TaskContext<unknown, StateShape, TUserEvents> & TExtension>(
        input: FlowInput<TContext>
    ): FlowDefinition<TContext>;

    group<TContext extends TaskContext<unknown, StateShape, TUserEvents> & TExtension>(
        id: string,
        children: readonly FlowNode<TContext>[],
        options?: GroupOptions
    ): GroupDefinition<TContext>;

    parallel<TContext extends TaskContext<unknown, StateShape, TUserEvents> & TExtension>(
        id: string,
        children: readonly FlowNode<TContext>[],
        options?: ParallelOptions<TContext>
    ): ParallelDefinition<TContext>;

    task<TContext extends TaskContext<unknown, StateShape, TUserEvents> & TExtension>(
        id: string,
        handler: TaskHandler<TContext>,
        options?: TaskOptions<TContext>
    ): TaskDefinition<TContext>;
}

export const createFlowKit = <TExtension extends object = object, TUserEvents extends EventMap = EventMap>(): FlowKit<
    TExtension,
    TUserEvents
> =>
    ({
        defineFlow: (input) => defineFlow(input),

        group: (id, children, options) => createGroup(id, children, options),

        parallel: (id, children, options) => createParallel(id, children, options),

        task: (id, handler, options) => createTask(id, handler, options),
    }) as FlowKit<TExtension, TUserEvents>;
