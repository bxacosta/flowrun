/**
 * definition/flow.ts — Flow definition & builder
 *
 * Layer: L3 (definition). The `flow(name)` chainable builder (params/state/
 * events/middleware/nodes) and the immutable {@link FlowDefinition} it produces.
 */

import { assertUniqueNodeNames, assertValidName } from "../core/validation.ts";
import type { EventMap } from "../events/types.ts";
import type { ParamsOf, Shape, WithEvents, WithParams, WithState } from "../shape/shape.ts";
import type { FlowContext } from "./context-types.ts";
import type { AnyMiddleware, Middleware } from "./middleware.ts";
import type { AnyStateFactory, NodeDefinition } from "./node.ts";
import { type NodesSpec, resolveNodes } from "./node-factory.ts";

// ── Definition ──────────────────────────────────────────────────────

export interface FlowDefinition<TShape extends Shape = Shape> {
    readonly _shape?: TShape;
    readonly middleware: readonly AnyMiddleware[];
    readonly name: string;
    readonly nodes: readonly NodeDefinition[];
    readonly state?: AnyStateFactory;
    readonly type: "flow";
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased flow definition for registries
export type AnyFlowDefinition = FlowDefinition<any>;

// ── Builder ─────────────────────────────────────────────────────────

export interface FlowBuilder<TShape extends Shape> {
    emits<TEvents extends EventMap>(): FlowBuilder<WithEvents<TShape, TEvents>>;
    middleware(list: NoInfer<Middleware<FlowContext<TShape>>>[]): FlowBuilder<TShape>;
    nodes(spec: NodesSpec<TShape>): FlowDefinition<TShape>;
    params<TParams extends object>(): FlowBuilder<WithParams<TShape, TParams>>;
    state<TState extends object, TParams extends ParamsOf<TShape> = ParamsOf<TShape>>(
        initial: TState | ((params: Readonly<TParams>) => TState)
    ): FlowBuilder<WithState<WithParams<TShape, TParams>, TState>>;
}

interface BuilderState {
    middleware: AnyMiddleware[];
    name: string;
    stateFactory?: AnyStateFactory;
}

function instantiate<TShape extends Shape>(state: BuilderState): FlowBuilder<TShape> {
    return {
        emits<TEvents extends EventMap>() {
            return instantiate<WithEvents<TShape, TEvents>>(state);
        },

        middleware(list) {
            return instantiate<TShape>({
                ...state,
                middleware: [...state.middleware, ...list],
            });
        },

        nodes(spec) {
            const resolved = resolveNodes<TShape>(spec);
            assertUniqueNodeNames(resolved, state.name);
            return {
                type: "flow",
                middleware: state.middleware,
                name: state.name,
                nodes: resolved,
                state: state.stateFactory,
            };
        },

        params<TParams extends object>() {
            return instantiate<WithParams<TShape, TParams>>(state);
        },

        state<TState extends object, TParams extends ParamsOf<TShape> = ParamsOf<TShape>>(
            initial: TState | ((params: Readonly<TParams>) => TState)
        ) {
            const stateFactory: AnyStateFactory =
                typeof initial === "function" ? (initial as AnyStateFactory) : () => initial;
            return instantiate<WithState<WithParams<TShape, TParams>, TState>>({ ...state, stateFactory });
        },
    };
}

export function flow<TShape extends Shape = Shape>(name: string): FlowBuilder<TShape> {
    assertValidName("flow", name);
    return instantiate<TShape>({ middleware: [], name });
}
