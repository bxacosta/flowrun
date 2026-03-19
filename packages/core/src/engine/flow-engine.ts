import { randomUUID } from "node:crypto";
import { FlowEngineError } from "../core/errors.ts";
import type {
    AnyExtension,
    AnyFlowDefinition,
    CompatibleFlow,
    EngineEventMap,
    EventMap,
    EventSubscriberApi,
    ExtensionContextMap,
    ExtensionEventMap,
    FlowEngineOptions,
    FlowHandle,
    FlowParams,
    FlowState,
    RunResult,
    StateShape,
    UserEventMap,
} from "../core/types.ts";
import { EventBus } from "../events/event-bus.ts";
import { executeFlow } from "../execution/execute-flow.ts";
import { resolveFlow } from "../execution/resolver.ts";
import { FlowHandleImpl } from "./flow-handle.ts";
import { RunController } from "./run-controller.ts";

export class FlowEngine<TUserEvents extends UserEventMap = {}, TExtensions extends readonly AnyExtension[] = []> {
    private readonly eventBus: EventBus<EngineEventMap<TUserEvents, ExtensionEventMap<TExtensions>>>;
    private readonly extensions: TExtensions;
    private readonly registry = new Map<string, AnyFlowDefinition>();

    readonly events: EventSubscriberApi<EngineEventMap<TUserEvents, ExtensionEventMap<TExtensions>>>;

    constructor(options?: FlowEngineOptions<TUserEvents, TExtensions>) {
        this.eventBus = new EventBus(options?.onSubscriberError);
        this.events = this.eventBus.createSubscriberApi();
        this.extensions = (options?.extensions ?? []) as unknown as TExtensions;

        for (const subscriber of options?.subscribers ?? []) {
            this.eventBus.register(subscriber);
        }
    }

    register<TFlow extends AnyFlowDefinition>(
        flow: CompatibleFlow<TFlow, TUserEvents, ExtensionContextMap<TExtensions>>
    ): void {
        if (this.registry.has(flow.id)) {
            throw new FlowEngineError(`Flow "${flow.id}" is already registered`);
        }

        this.registry.set(flow.id, flow);
    }

    start<TFlow extends AnyFlowDefinition>(
        flow: CompatibleFlow<TFlow, TUserEvents, ExtensionContextMap<TExtensions>>,
        params: FlowParams<TFlow>
    ): FlowHandle<FlowState<TFlow>>;
    start(flowId: string, params: unknown): FlowHandle<StateShape>;
    start<TFlow extends AnyFlowDefinition>(
        flowOrId: CompatibleFlow<TFlow, TUserEvents, ExtensionContextMap<TExtensions>> | string,
        params: FlowParams<TFlow> | unknown
    ): FlowHandle<FlowState<TFlow>> | FlowHandle<StateShape> {
        const flow = this.resolveFlowDefinition(flowOrId);
        const plan = resolveFlow(flow);
        const runController = new RunController();
        const runId = randomUUID();

        const resultPromise = executeFlow({
            eventBus: this.eventBus as unknown as EventBus<EventMap>,
            extensions: this.extensions,
            params,
            plan,
            runController,
            runId,
        });

        return new FlowHandleImpl(flow.id, runId, runController, resultPromise);
    }

    run<TFlow extends AnyFlowDefinition>(
        flow: CompatibleFlow<TFlow, TUserEvents, ExtensionContextMap<TExtensions>>,
        params: FlowParams<TFlow>
    ): Promise<RunResult<FlowState<TFlow>>>;
    run(flowId: string, params: unknown): Promise<RunResult<StateShape>>;
    async run<TFlow extends AnyFlowDefinition>(
        flowOrId: CompatibleFlow<TFlow, TUserEvents, ExtensionContextMap<TExtensions>> | string,
        params: FlowParams<TFlow> | unknown
    ): Promise<RunResult<FlowState<TFlow>> | RunResult<StateShape>> {
        if (typeof flowOrId === "string") {
            return this.start(flowOrId, params).join();
        }

        return this.start(flowOrId, params as FlowParams<TFlow>).join();
    }

    private resolveFlowDefinition<TFlow extends AnyFlowDefinition>(
        flowOrId: CompatibleFlow<TFlow, TUserEvents, ExtensionContextMap<TExtensions>> | string
    ): AnyFlowDefinition {
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
    TUserEvents extends UserEventMap = {},
    TExtensions extends readonly AnyExtension[] = [],
>(
    options?: FlowEngineOptions<TUserEvents, TExtensions>
): FlowEngine<TUserEvents, TExtensions> => new FlowEngine<TUserEvents, TExtensions>(options);
