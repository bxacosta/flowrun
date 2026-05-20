import { createFlowBuilder, type FlowBuilder } from "./builder.ts";
import type { FlowContext, TaskContext } from "./context.ts";
import type { SystemEvents, SystemPublicEvents } from "./events.ts";
import type { Middleware } from "./middleware.ts";
import type { Node } from "./node.ts";
import {
    buildEvery,
    buildMiddleware,
    buildParallel,
    buildTask,
    type EveryConfig,
    type EveryConfigWithResource,
    type MiddlewareConfig,
    type ParallelConfig,
    type ParallelConfigWithResource,
    type TaskConfig,
} from "./node-factory.ts";
import type { AnyScope, Scope } from "./scope.ts";
import type { EmptyObject } from "./utils.ts";

export interface ShapeContract {
    events?: object;
    internalEvents?: object;
    params?: object;
    provided?: object;
    state?: object;
}

type ContractField<TContract, TKey extends keyof ShapeContract, TFallback extends object> = TKey extends keyof TContract
    ? NonNullable<TContract[TKey]> extends object
        ? NonNullable<TContract[TKey]>
        : TFallback
    : TFallback;

export type ScopeFromShape<TContract extends ShapeContract> = Scope<
    ContractField<TContract, "provided", EmptyObject>,
    ContractField<TContract, "params", EmptyObject>,
    ContractField<TContract, "state", EmptyObject>,
    SystemPublicEvents & ContractField<TContract, "events", EmptyObject>,
    SystemEvents &
        ContractField<TContract, "events", EmptyObject> &
        ContractField<TContract, "internalEvents", EmptyObject>
>;

export interface Shape<TScope extends AnyScope> {
    every<TItem>(config: EveryConfig<TScope, TItem>): Node<TScope>;
    every<TItem, TLocal extends object>(config: EveryConfigWithResource<TScope, TItem, TLocal>): Node<TScope>;
    flow(name: string): FlowBuilder<TScope>;
    flowMiddleware(config: MiddlewareConfig<FlowContext<TScope>>): Middleware<FlowContext<TScope>>;
    parallel(config: ParallelConfig<TScope>): Node<TScope>;
    parallel<TLocal extends object>(config: ParallelConfigWithResource<TScope, TLocal>): Node<TScope>;
    task(config: TaskConfig<TScope>): Node<TScope>;
    taskMiddleware(config: MiddlewareConfig<TaskContext<TScope>>): Middleware<TaskContext<TScope>>;
}

export function shape<TContract extends ShapeContract = EmptyObject>(): Shape<ScopeFromShape<TContract>> {
    return {
        every: buildEvery,
        flow: (name) => createFlowBuilder(name),
        flowMiddleware: buildMiddleware,
        parallel: buildParallel,
        task: buildTask,
        taskMiddleware: buildMiddleware,
    } as Shape<ScopeFromShape<TContract>>;
}
