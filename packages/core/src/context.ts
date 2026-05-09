import { SkipSignal } from "./errors.ts";
import type { InternalBus, PublishableBus } from "./event-bus.ts";
import type { EventMap, EventSource, SystemEvents, SystemPublicEvents } from "./events.ts";
import type { Logger } from "./logger.ts";
import type { Middleware } from "./middleware.ts";
import type { TaskResult } from "./node.ts";
import type { ContextRequest, RequestDefinition, RequestOptions } from "./request.ts";
import type { RequestManager } from "./request-manager.ts";
import type { AnyScope, Scope } from "./scope.ts";
import type { PauseGate } from "./signal.ts";
import type { AnyFlowStateStore, FlowStateStore } from "./state.ts";
import type { EmptyObject } from "./utils.ts";

type IterationField<TIteration> = [TIteration] extends [never] ? EmptyObject : { readonly iteration: TIteration };
type DomainEvents<TPublicEvents extends EventMap> = Omit<TPublicEvents, keyof SystemPublicEvents>;

export type ContextPublish<TPublicEvents extends EventMap> = <K extends keyof DomainEvents<TPublicEvents> & string>(
    topic: K,
    payload: DomainEvents<TPublicEvents>[K],
    options?: { correlationId?: string; source?: string }
) => Promise<void>;

type BaseContextOf<
    TProvided extends object = EmptyObject,
    TParams extends object = EmptyObject,
    TState extends object = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = SystemEvents,
> = TProvided & {
    bus: PublishableBus<TPublicEvents, TAllEvents>;
    flowName: string;
    log: Logger;
    params: Readonly<TParams>;
    publish: ContextPublish<TPublicEvents>;
    request: ContextRequest;
    runId: string;
    signal: AbortSignal;
    state: FlowStateStore<TState>;
};

type TaskExtras<TIteration = never> = {
    attempt: number;
    nodeName: string;
    skip: (reason?: string) => never;
} & IterationField<TIteration>;

export type BaseContext<TScope extends AnyScope = Scope> = BaseContextOf<
    TScope["_provided"],
    TScope["_params"],
    TScope["_state"],
    TScope["_publicEvents"],
    TScope["_allEvents"]
>;

export type FlowContext<TScope extends AnyScope = Scope> = BaseContext<TScope>;
export type ItemsContext<TScope extends AnyScope = Scope> = BaseContext<TScope> & IterationField<TScope["_iteration"]>;
export type TaskContext<TScope extends AnyScope = Scope> = BaseContext<TScope> & TaskExtras<TScope["_iteration"]>;

export type FlowMiddlewareOf<
    TProvided extends object = EmptyObject,
    TParams extends object = EmptyObject,
    TState extends object = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = SystemEvents,
> = Middleware<BaseContextOf<TProvided, TParams, TState, TPublicEvents, TAllEvents>>;

export type TaskMiddlewareOf<
    TProvided extends object = EmptyObject,
    TParams extends object = EmptyObject,
    TState extends object = EmptyObject,
    TPublicEvents extends EventMap = SystemPublicEvents,
    TAllEvents extends EventMap = SystemEvents,
    TIteration = never,
> = Middleware<BaseContextOf<TProvided, TParams, TState, TPublicEvents, TAllEvents> & TaskExtras<TIteration>>;

export interface FlowRuntime {
    bus: InternalBus<EventMap>;
    flowName: string;
    log: Logger;
    params: Readonly<Record<string, unknown>>;
    provided: Record<string, unknown>;
    publicBus: PublishableBus<EventMap, EventMap>;
    requests: RequestManager;
    runId: string;
}

export interface FlowProgress {
    taskResults: TaskResult[];
}

export interface RequestRuntimeMeta {
    attempt?: number;
    iteration?: { index: number; item: unknown };
    nodeName?: string;
    path: readonly string[];
}

export interface ExecutionContext {
    pathSegments: readonly string[];
    pauseGate: PauseGate;
    progress: FlowProgress;
    runtime: FlowRuntime;
}

function createContextRequest(runtime: FlowRuntime, signal: AbortSignal, meta: RequestRuntimeMeta): ContextRequest {
    return <TPayload, TResponse>(
        definition: RequestDefinition<TPayload, TResponse>,
        payload: TPayload,
        options?: RequestOptions
    ) =>
        runtime.requests.open({
            attempt: meta.attempt,
            definition,
            flowName: runtime.flowName,
            iteration: meta.iteration,
            nodeName: meta.nodeName,
            options,
            path: meta.path,
            payload,
            runId: runtime.runId,
            signal,
        });
}

function buildBaseContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    source: EventSource,
    meta: RequestRuntimeMeta
): Record<string, unknown> {
    return {
        ...runtime.provided,
        bus: runtime.publicBus,
        flowName: runtime.flowName,
        log: runtime.log,
        params: runtime.params,
        publish: (topic: string, payload: unknown, options?: { correlationId?: string; source?: string }) =>
            runtime.publicBus.publish(topic, payload, { source, ...options }),
        request: createContextRequest(runtime, signal, meta),
        runId: runtime.runId,
        signal,
        state,
    };
}

export function buildFlowContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal
): Record<string, unknown> {
    return buildBaseContext(runtime, state, signal, "flow", { path: [] });
}

export function buildItemsContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    pathSegments: readonly string[],
    iteration?: { index: number; item: unknown },
    source: EventSource = "container"
): Record<string, unknown> {
    const context = buildBaseContext(runtime, state, signal, source, { iteration, path: pathSegments });
    if (!iteration) {
        return context;
    }
    return {
        ...context,
        iteration: Object.freeze({ index: iteration.index, item: iteration.item }),
    };
}

export function buildTaskContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    pathSegments: readonly string[],
    nodeName: string,
    attempt: number,
    iteration?: { index: number; item: unknown }
): Record<string, unknown> {
    const meta: RequestRuntimeMeta = { attempt, iteration, nodeName, path: pathSegments };
    const context: Record<string, unknown> = {
        ...buildBaseContext(runtime, state, signal, "task", meta),
        attempt,
        nodeName,
        skip: (reason?: string) => {
            throw new SkipSignal(reason);
        },
    };

    if (!iteration) {
        return context;
    }

    return {
        ...context,
        iteration: Object.freeze({ index: iteration.index, item: iteration.item }),
    };
}
