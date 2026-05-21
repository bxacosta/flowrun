import { createFlowBuilder, type FlowBuilder } from "./builder.ts";
import { createNodeFactory, type NodeFactory } from "./node-factory.ts";
import type { Shape } from "./shape.ts";

export interface ShapeFactory<TShape extends Shape> extends NodeFactory<TShape> {
    flow(name: string): FlowBuilder<TShape>;
}

export function shape<TShape extends Shape = Shape>(): ShapeFactory<TShape> {
    return {
        ...createNodeFactory<TShape>(),
        flow: (name: string) => createFlowBuilder<TShape>(name),
    };
}
