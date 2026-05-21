import { createFlowBuilder, type FlowBuilder } from "./builder.ts";
import type { Node } from "./node.ts";
import {
    buildEvery,
    buildParallel,
    buildTask,
    type EveryConfig,
    type EveryConfigWithResource,
    type ParallelConfig,
    type ParallelConfigWithResource,
    type TaskConfig,
} from "./node-factory.ts";
import type { Shape } from "./shape.ts";

export interface ShapeFactory<TShape extends Shape> {
    every<TItem>(config: EveryConfig<TShape, TItem>): Node<TShape>;
    every<TItem, TLocal extends object>(config: EveryConfigWithResource<TShape, TItem, TLocal>): Node<TShape>;
    flow(name: string): FlowBuilder<TShape>;
    parallel(config: ParallelConfig<TShape>): Node<TShape>;
    parallel<TLocal extends object>(config: ParallelConfigWithResource<TShape, TLocal>): Node<TShape>;
    task(config: TaskConfig<TShape>): Node<TShape>;
}

export function shape<TShape extends Shape = Shape>(): ShapeFactory<TShape> {
    return {
        every: buildEvery,
        flow: (name: string) => createFlowBuilder(name),
        parallel: buildParallel,
        task: buildTask,
    } as unknown as ShapeFactory<TShape>;
}
