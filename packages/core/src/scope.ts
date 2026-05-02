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

export type WithProvided<TScope extends AnyScope, TLocal extends object> = Scope<
    MergeObjects<TScope["_provided"], TLocal>,
    TScope["_params"],
    TScope["_state"],
    TScope["_publicEvents"],
    TScope["_allEvents"],
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

export interface ScopeContract {
    events?: object;
    internalEvents?: object;
    params?: object;
    provided?: object;
    state?: object;
}

type ContractField<TContract, TKey extends keyof ScopeContract, TFallback extends object> = TKey extends keyof TContract
    ? NonNullable<TContract[TKey]> extends object
        ? NonNullable<TContract[TKey]>
        : TFallback
    : TFallback;

export type ScopeFromContract<TContract extends ScopeContract> = Scope<
    ContractField<TContract, "provided", EmptyObject>,
    ContractField<TContract, "params", EmptyObject>,
    ContractField<TContract, "state", EmptyObject>,
    SystemPublicEvents & ContractField<TContract, "events", EmptyObject>,
    SystemEvents &
        ContractField<TContract, "events", EmptyObject> &
        ContractField<TContract, "internalEvents", EmptyObject>
>;
