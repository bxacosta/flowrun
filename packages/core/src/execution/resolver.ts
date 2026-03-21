import type { FlowDefinition, FlowNode, ParallelDefinition, TaskDefinition } from "../core/types.ts";

export interface ResolvedTaskNode {
    readonly definition: TaskDefinition<any>;
    readonly kind: "task";
}

export interface ResolvedParallelNode {
    readonly branches: readonly ResolvedNode[][];
    readonly definition: ParallelDefinition<any>;
    readonly kind: "parallel";
}

export type ResolvedNode = ResolvedParallelNode | ResolvedTaskNode;

export interface ResolvedFlowPlan {
    readonly flow: FlowDefinition<any>;
    readonly nodes: readonly ResolvedNode[];
}

const resolveNodes = (nodes: readonly FlowNode<any>[]): ResolvedNode[] => {
    const result: ResolvedNode[] = [];

    for (const node of nodes) {
        if (node.kind === "task") {
            result.push({ definition: node, kind: "task" });
            continue;
        }

        if (node.kind === "group") {
            result.push(...resolveNodes(node.children));
            continue;
        }

        result.push({
            branches: node.children.map((child) => resolveNodes([child])),
            definition: node,
            kind: "parallel",
        });
    }

    return result;
};

export const resolveFlow = (flow: FlowDefinition<any>): ResolvedFlowPlan => ({
    flow,
    nodes: resolveNodes(flow.nodes),
});
