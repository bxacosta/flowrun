import { randomUUID } from "node:crypto";
import { FlowEngineError } from "../core/errors.ts";
import type {
    EngineEventMap,
    EventMap,
    EventSubscriber,
    EventSubscriberApi,
    FlowDefinition,
    FlowEngineOptions,
    FlowHandle,
    MergeServiceTypes,
    ParamsOf,
    RunResult,
    ServiceFactory,
    ServiceFactoryApi,
    StateOf,
    StateShape,
    TaskContext,
} from "../core/types.ts";
import { EventBus } from "../events/event-bus.ts";
import { executeFlow } from "../execution/execute-flow.ts";
import { resolveFlow } from "../execution/resolver.ts";
import { FlowHandleImpl } from "./flow-handle.ts";
import { RunController } from "./run-controller.ts";

const normalizeServices = (
    services: readonly ServiceFactory<object>[] | undefined
): ServiceFactory<object> | undefined => {
    if (services === undefined || services.length === 0) {
        return undefined;
    }

    if (services.length === 1) {
        return services[0];
    }

    return {
        create: async (api: ServiceFactoryApi) => {
            let merged: object = {};

            for (const service of services) {
                const ctx = await service.create(api);
                merged = { ...merged, ...ctx };
            }

            return merged;
        },
        dispose: async (ext: object, api: ServiceFactoryApi) => {
            for (let i = services.length - 1; i >= 0; i--) {
                const service = services[i];

                if (service?.dispose !== undefined) {
                    await service.dispose(ext, api);
                }
            }
        },
    };
};

export class FlowEngine<TExt extends object = object, TUserEvents extends EventMap = {}> {
    private readonly eventBus: EventBus<EventMap>;
    private readonly registry = new Map<string, FlowDefinition<any>>();
    private readonly service: ServiceFactory<object> | undefined;

    readonly events: EventSubscriberApi<EngineEventMap<TUserEvents>>;

    constructor(options?: FlowEngineOptions<TUserEvents>) {
        this.eventBus = new EventBus(options?.onSubscriberError);
        this.events = this.eventBus.createSubscriberApi() as EventSubscriberApi<EngineEventMap<TUserEvents>>;
        this.service = normalizeServices(options?.services);

        for (const subscriber of options?.subscribers ?? []) {
            this.eventBus.register(subscriber as EventSubscriber<EventMap>);
        }
    }

    register<TContext extends TaskContext & TExt>(flow: FlowDefinition<TContext>): void {
        if (this.registry.has(flow.id)) {
            throw new FlowEngineError(`Flow "${flow.id}" is already registered`);
        }

        this.registry.set(flow.id, flow);
    }

    start<TContext extends TaskContext & TExt>(
        flow: FlowDefinition<TContext>,
        params: ParamsOf<TContext>
    ): FlowHandle<StateOf<TContext>>;
    start(flowId: string, params: unknown): FlowHandle<StateShape>;
    start(flowOrId: FlowDefinition<any> | string, params: unknown): FlowHandle<StateShape> {
        const flow = this.resolveFlowDefinition(flowOrId);
        const plan = resolveFlow(flow);
        const runController = new RunController();
        const runId = randomUUID();

        const resultPromise = executeFlow({
            eventBus: this.eventBus,
            params,
            plan,
            runController,
            runId,
            service: this.service,
        });

        return new FlowHandleImpl(flow.id, runId, runController, resultPromise);
    }

    run<TContext extends TaskContext & TExt>(
        flow: FlowDefinition<TContext>,
        params: ParamsOf<TContext>
    ): Promise<RunResult<StateOf<TContext>>>;
    run(flowId: string, params: unknown): Promise<RunResult<StateShape>>;
    async run(flowOrId: FlowDefinition<any> | string, params: unknown): Promise<RunResult<StateShape>> {
        return this.start(flowOrId as string, params).join();
    }

    private resolveFlowDefinition(flowOrId: FlowDefinition<any> | string): FlowDefinition<any> {
        if (typeof flowOrId !== "string") {
            return flowOrId;
        }

        const flow = this.registry.get(flowOrId);

        if (flow === undefined) {
            throw new FlowEngineError(`Flow "${flowOrId}" is not registered`);
        }

        return flow;
    }
}

export const createFlowEngine = <
    const TServices extends readonly ServiceFactory<object>[] = [],
    TUserEvents extends EventMap = {},
>(
    options?: FlowEngineOptions<TUserEvents> & {
        readonly services?: TServices;
    }
): FlowEngine<MergeServiceTypes<TServices>, TUserEvents> =>
    new FlowEngine<MergeServiceTypes<TServices>, TUserEvents>(options);
