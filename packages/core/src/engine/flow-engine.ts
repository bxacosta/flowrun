import { randomUUID } from "node:crypto";
import { FlowEngineError } from "../core/errors.ts";
import type {
    AnyFlowDefinition,
    EmptyEventMap,
    EngineEventMap,
    EventMap,
    EventSubscriber,
    EventSubscriberApi,
    Extension,
    ExtensionApi,
    FlowDefinition,
    FlowEngineOptions,
    FlowHandle,
    MergeExtensionTypes,
    ParamsOf,
    RunResult,
    StateOf,
    StateShape,
    TaskContext,
} from "../core/types.ts";
import { EventBus } from "../events/event-bus.ts";
import { executeFlow } from "../execution/execute-flow.ts";
import { resolveFlow } from "../execution/resolver.ts";
import { FlowHandleImpl } from "./flow-handle.ts";
import { RunController } from "./run-controller.ts";

const normalizeExtensions = (extensions: readonly Extension<object>[] | undefined): Extension<object> | undefined => {
    if (extensions === undefined || extensions.length === 0) {
        return undefined;
    }

    if (extensions.length === 1) {
        return extensions[0];
    }

    return {
        create: async (extensionApi: ExtensionApi) => {
            let merged: object = {};

            for (const extension of extensions) {
                const extensionContext = await extension.create(extensionApi);
                merged = { ...merged, ...extensionContext };
            }

            return merged;
        },
        dispose: async (extensionContext: object, extensionApi: ExtensionApi) => {
            for (let i = extensions.length - 1; i >= 0; i--) {
                const extension = extensions[i];

                if (extension?.dispose !== undefined) {
                    await extension.dispose(extensionContext, extensionApi);
                }
            }
        },
    };
};

export class FlowEngine<TExtension extends object = object, TUserEvents extends EventMap = EmptyEventMap> {
    private readonly eventBus: EventBus<EventMap>;
    private readonly extension: Extension<object> | undefined;
    private readonly registry = new Map<string, AnyFlowDefinition>();

    readonly events: EventSubscriberApi<EngineEventMap<TUserEvents>>;

    constructor(options?: FlowEngineOptions<TUserEvents>) {
        this.eventBus = new EventBus(options?.onSubscriberError);
        this.events = this.eventBus.createSubscriberApi() as EventSubscriberApi<EngineEventMap<TUserEvents>>;
        this.extension = normalizeExtensions(options?.extensions);

        for (const subscriber of options?.subscribers ?? []) {
            this.eventBus.register(subscriber as EventSubscriber<EventMap>);
        }
    }

    register<TContext extends TaskContext & TExtension>(flow: FlowDefinition<TContext>): void {
        if (this.registry.has(flow.id)) {
            throw new FlowEngineError(`Flow "${flow.id}" is already registered`);
        }

        this.registry.set(flow.id, flow);
    }

    start<TContext extends TaskContext & TExtension>(
        flow: FlowDefinition<TContext>,
        params: ParamsOf<TContext>
    ): FlowHandle<StateOf<TContext>>;
    start(flowId: string, params: unknown): FlowHandle<StateShape>;
    start(flowOrId: AnyFlowDefinition | string, params: unknown): FlowHandle<StateShape> {
        const flow = this.resolveFlowDefinition(flowOrId);
        const plan = resolveFlow(flow);
        const runController = new RunController();
        const runId = randomUUID();

        const resultPromise = executeFlow({
            eventBus: this.eventBus,
            extension: this.extension,
            params,
            plan,
            runController,
            runId,
        });

        return new FlowHandleImpl(flow.id, runId, runController, resultPromise);
    }

    run<TContext extends TaskContext & TExtension>(
        flow: FlowDefinition<TContext>,
        params: ParamsOf<TContext>
    ): Promise<RunResult<StateOf<TContext>>>;
    run(flowId: string, params: unknown): Promise<RunResult<StateShape>>;
    run(flowOrId: AnyFlowDefinition | string, params: unknown): Promise<RunResult<StateShape>> {
        return this.start(flowOrId as string, params).join();
    }

    private resolveFlowDefinition(flowOrId: AnyFlowDefinition | string): AnyFlowDefinition {
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
    const TExtensions extends readonly Extension<object>[] = [],
    TUserEvents extends EventMap = EmptyEventMap,
>(
    options?: FlowEngineOptions<TUserEvents> & {
        readonly extensions?: TExtensions;
    }
): FlowEngine<MergeExtensionTypes<TExtensions>, TUserEvents> =>
    new FlowEngine<MergeExtensionTypes<TExtensions>, TUserEvents>(options);
