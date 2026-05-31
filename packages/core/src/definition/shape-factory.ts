/**
 * definition/shape-factory.ts — Shape-bound factory
 *
 * Layer: L3 (definition). Binds a Shape once so nodes and the flow builder can
 * be authored standalone and assembled later, all sharing one typed contract.
 */

import type { Shape } from "../shape/shape.ts";
import { type FlowBuilder, flow } from "./flow.ts";
import { createNodeFactory, type NodeFactory } from "./node-factory.ts";

export interface ShapeFactory<TShape extends Shape> extends NodeFactory<TShape> {
    flow(name: string): FlowBuilder<TShape>;
}

export function shape<TShape extends Shape = Shape>(): ShapeFactory<TShape> {
    return {
        ...createNodeFactory<TShape>(),
        flow: (name: string) => flow<TShape>(name),
    };
}
