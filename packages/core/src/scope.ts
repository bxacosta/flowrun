import type { EventMap, SystemEvents, SystemPublicEvents } from "./events.ts";
import type { EmptyObject, MergeObjects } from "./utils.ts";

export interface IterationContext<TItem> {
    index: number;
    item: TItem;
}

export interface Scope<
    TProvided extends object = EmptyObject,
    TParams extends object = EmptyObject,
    TState extends object = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = SystemEvents,
    TIteration = never,
> {
    readonly _allEvents: TAllEvents;
    readonly _iteration: TIteration;
    readonly _params: TParams;
    readonly _provided: TProvided;
    readonly _publicEvents: TPublicEvents;
    readonly _state: TState;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased scope for heterogeneous registries
export type AnyScope = Scope<any, any, any, any, any, any>;

export type RootScope = Scope<EmptyObject, EmptyObject, EmptyObject, SystemPublicEvents, SystemEvents, never>;

export type WithProvided<TScope extends AnyScope, TLocal extends object> = Scope<
    MergeObjects<TScope["_provided"], TLocal>,
    TScope["_params"],
    TScope["_state"],
    TScope["_publicEvents"],
    TScope["_allEvents"],
    TScope["_iteration"]
>;

export type WithParams<TScope extends AnyScope, TParams extends object> = Scope<
    TScope["_provided"],
    TParams,
    TScope["_state"],
    TScope["_publicEvents"],
    TScope["_allEvents"],
    TScope["_iteration"]
>;

export type WithState<TScope extends AnyScope, TState extends object> = Scope<
    TScope["_provided"],
    TScope["_params"],
    TState,
    TScope["_publicEvents"],
    TScope["_allEvents"],
    TScope["_iteration"]
>;

export type WithEvents<TScope extends AnyScope, TPublicEvents extends EventMap> = Scope<
    TScope["_provided"],
    TScope["_params"],
    TScope["_state"],
    MergeObjects<TScope["_publicEvents"], TPublicEvents>,
    MergeObjects<TScope["_allEvents"], TPublicEvents>,
    TScope["_iteration"]
>;

export type IterationScope<TScope extends AnyScope, TItem> = Scope<
    TScope["_provided"],
    TScope["_params"],
    TScope["_state"],
    TScope["_publicEvents"],
    TScope["_allEvents"],
    IterationContext<TItem>
>;
