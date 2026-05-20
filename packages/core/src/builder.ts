import type { FlowContext } from "./context.ts";
import type { EventMap } from "./events.ts";
import type { FlowDefinition } from "./flow-runner.ts";
import type { AnyMiddleware, Middleware } from "./middleware.ts";
import type { AnyStateFactory } from "./node.ts";
import { type NodesSpec, resolveNodes } from "./node-factory.ts";
import type { AnyScope, RootScope, WithEvents, WithParams, WithState } from "./scope.ts";
import { assertUniqueNodeNames } from "./validation.ts";

export interface FlowBuilder<TScope extends AnyScope> {
    events<TPublicEvents extends EventMap>(): FlowBuilder<WithEvents<TScope, TPublicEvents>>;
    middleware(list: NoInfer<Middleware<FlowContext<TScope>>>[]): FlowBuilder<TScope>;
    nodes(spec: NodesSpec<TScope>): FlowDefinition<TScope>;
    params<TParams extends object>(): FlowBuilder<WithParams<TScope, TParams>>;
    state<TState extends object, TParams extends TScope["_params"] = TScope["_params"]>(
        initial: TState | ((params: Readonly<TParams>) => TState)
    ): FlowBuilder<WithState<WithParams<TScope, TParams>, TState>>;
}

interface BuilderState {
    middleware: AnyMiddleware[];
    name: string;
    stateFactory?: AnyStateFactory;
}

function instantiate<TScope extends AnyScope>(state: BuilderState): FlowBuilder<TScope> {
    return {
        events<TPublicEvents extends EventMap>() {
            return instantiate<WithEvents<TScope, TPublicEvents>>(state);
        },

        middleware(list) {
            return instantiate<TScope>({
                ...state,
                middleware: [...state.middleware, ...list],
            });
        },

        nodes(spec) {
            const resolved = resolveNodes<TScope>(spec);
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
            return instantiate<WithParams<TScope, TParams>>(state);
        },

        state<TState extends object, TParams extends TScope["_params"] = TScope["_params"]>(
            initial: TState | ((params: Readonly<TParams>) => TState)
        ) {
            const stateFactory: AnyStateFactory =
                typeof initial === "function" ? (initial as AnyStateFactory) : () => initial;
            return instantiate<WithState<WithParams<TScope, TParams>, TState>>({ ...state, stateFactory });
        },
    };
}

export function createFlowBuilder<TScope extends AnyScope>(name: string): FlowBuilder<TScope> {
    return instantiate<TScope>({ middleware: [], name });
}

export function flow(name: string): FlowBuilder<RootScope> {
    return createFlowBuilder<RootScope>(name);
}
