import type {
    FlowDefinition,
    FlowNode,
    GroupDefinition,
    GroupOptions,
    ParallelDefinition,
    ParallelOptions,
    TaskContext,
    TaskDefinition,
    TaskHandler,
    TaskOptions,
} from "../core/types.ts";
import { defineFlow, type FlowInput } from "./define-flow.ts";
import { group as createGroup, parallel as createParallel, task as createTask } from "./node-factories.ts";

export interface FlowKit<TExt extends object = object> {
    defineFlow<TContext extends TaskContext & TExt>(input: FlowInput<TContext>): FlowDefinition<TContext>;

    group<TContext extends TaskContext & TExt>(
        id: string,
        children: readonly FlowNode<TContext>[],
        options?: GroupOptions
    ): GroupDefinition<TContext>;

    parallel<TContext extends TaskContext & TExt>(
        id: string,
        children: readonly FlowNode<TContext>[],
        options?: ParallelOptions<TContext>
    ): ParallelDefinition<TContext>;

    task<TContext extends TaskContext & TExt>(
        id: string,
        handler: TaskHandler<TContext>,
        options?: TaskOptions<TContext>
    ): TaskDefinition<TContext>;
}

export const createFlowKit = <TExt extends object = object>(): FlowKit<TExt> =>
    ({
        defineFlow: (input) => defineFlow(input),

        group: (id, children, options) => createGroup(id, children, options),

        parallel: (id, children, options) => createParallel(id, children, options),

        task: (id, handler, options) => createTask(id, handler, options),
    }) as FlowKit<TExt>;
