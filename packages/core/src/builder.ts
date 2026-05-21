import type { FlowContext } from "./context.ts";
import type { EventMap } from "./events.ts";
import type { FlowDefinition } from "./flow-runner.ts";
import type { AnyMiddleware, Middleware } from "./middleware.ts";
import type { AnyStateFactory } from "./node.ts";
import { type NodesSpec, resolveNodes } from "./node-factory.ts";
import type { ParamsOf, Shape, WithEvents, WithParams, WithState } from "./shape.ts";
import { assertUniqueNodeNames } from "./validation.ts";

export interface FlowBuilder<TShape extends Shape> {
    events<TEvents extends EventMap>(): FlowBuilder<WithEvents<TShape, TEvents>>;
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
        events<TEvents extends EventMap>() {
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
                kind: "flow",
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

export function createFlowBuilder<TShape extends Shape>(name: string): FlowBuilder<TShape> {
    return instantiate<TShape>({ middleware: [], name });
}

export function flow(name: string): FlowBuilder<Shape> {
    return createFlowBuilder<Shape>(name);
}
