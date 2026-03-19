import type {
    ErasedFlowNode,
    FlowDefinition,
    ParallelDefinition,
    StateShape,
    TaskDefinition,
    UserEventMap,
} from "../core/types.ts";

export interface ResolvedTaskNode<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
> {
    readonly definition: TaskDefinition<TParams, TState, TUserEvents, TBaseContext, object>;
    readonly kind: "task";
}

export interface ResolvedParallelNode<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
> {
    readonly branches: readonly ResolvedNode<TParams, TState, TUserEvents, TBaseContext>[][];
    readonly definition: ParallelDefinition<TParams, TState, TUserEvents, TBaseContext, object>;
    readonly kind: "parallel";
}

export type ResolvedNode<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
> =
    | ResolvedParallelNode<TParams, TState, TUserEvents, TBaseContext>
    | ResolvedTaskNode<TParams, TState, TUserEvents, TBaseContext>;

export interface ResolvedFlowPlan<
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
> {
    readonly flow: FlowDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>;
    readonly nodes: readonly ResolvedNode<TParams, TState, TUserEvents, TBaseContext>[];
}

const resolveNodes = <
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
>(
    nodes: readonly ErasedFlowNode<TParams, TState, TUserEvents, TBaseContext>[]
): ResolvedNode<TParams, TState, TUserEvents, TBaseContext>[] => {
    const result: ResolvedNode<TParams, TState, TUserEvents, TBaseContext>[] = [];

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

export const resolveFlow = <
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
    TRequiredContext extends object,
>(
    flow: FlowDefinition<TParams, TState, TUserEvents, TBaseContext, TRequiredContext>
): ResolvedFlowPlan<TParams, TState, TUserEvents, TBaseContext, TRequiredContext> => ({
    flow,
    nodes: resolveNodes(flow.nodes),
});
