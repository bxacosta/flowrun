import { DuplicateExtensionError, DuplicateFlowError, FlowNotRegisteredError } from "./errors.ts";
import type { EventBusConfig, ReadableBus } from "./event-bus.ts";
import { createEventBus } from "./event-bus.ts";
import type { EventMap, MergeAllEvents, MergePublicEvents, SystemEvents, SystemPublicEvents } from "./events.ts";
import type {
    AnyExtensionDefinition,
    ExtensionDefinition,
    ExtensionInternalEvents,
    ExtensionProvided,
    ExtensionPublicEvents,
} from "./extension.ts";
import type {
    AnyFlow,
    AnyFlowDefinition,
    AnyRunArgs,
    Flow,
    FlowDefinition,
    FlowHandle,
    FlowResult,
    RunArgs,
} from "./flow-runner.ts";
import { runFlow, startFlow } from "./flow-runner.ts";
import type { EngineRequests } from "./request.ts";
import { createRequestManager } from "./request-manager.ts";
import type { ParamsOf, ProvidedOf, Shape, StateOf } from "./shape.ts";
import type { EmptyObject, MergeObjects } from "./utils.ts";

type CompatibleFlow<TProvided extends object, TShape extends Shape> =
    TProvided extends ProvidedOf<TShape> ? FlowDefinition<TShape> : never;

export interface EngineConfig {
    events?: EventBusConfig;
}

export interface Engine<TProvided extends object, TPublicEvents extends EventMap, TAllEvents extends EventMap> {
    bus: ReadableBus<TAllEvents>;

    flows(): readonly string[];

    getFlow(name: string): Flow<Record<string, unknown>, Record<string, unknown>>;

    register<TShape extends Shape>(flow: CompatibleFlow<TProvided, TShape>): Flow<ParamsOf<TShape>, StateOf<TShape>>;

    requests: EngineRequests;

    run<TShape extends Shape>(
        flow: CompatibleFlow<TProvided, TShape>,
        ...args: RunArgs<ParamsOf<TShape>>
    ): Promise<FlowResult<StateOf<TShape>>>;

    start<TShape extends Shape>(
        flow: CompatibleFlow<TProvided, TShape>,
        ...args: RunArgs<ParamsOf<TShape>>
    ): Promise<FlowHandle<StateOf<TShape>>>;

    use<TExtension extends ExtensionDefinition<object, object, object>>(
        extension: TExtension
    ): Engine<
        MergeObjects<TProvided, ExtensionProvided<TExtension>>,
        MergePublicEvents<TPublicEvents, ExtensionPublicEvents<TExtension>>,
        MergeAllEvents<TAllEvents, ExtensionInternalEvents<TExtension>, ExtensionPublicEvents<TExtension>>
    >;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased engine implementation with typed public facade
type AnyEngine = Engine<any, any, any>;

function createRunnable(
    flow: AnyFlowDefinition,
    extensions: readonly AnyExtensionDefinition[],
    bus: ReturnType<typeof createEventBus<EventMap>>,
    requests: ReturnType<typeof createRequestManager>
): AnyFlow {
    const buildArgs = (args: AnyRunArgs) => ({
        bus,
        extensions,
        flow,
        params: args[0] ?? {},
        requests,
    });

    return {
        name: flow.name,
        run: (...args: AnyRunArgs) => runFlow(buildArgs(args)),
        start: (...args: AnyRunArgs) => startFlow(buildArgs(args)),
    };
}

export function createEngine(config?: EngineConfig): Engine<EmptyObject, SystemPublicEvents, SystemEvents> {
    const bus = createEventBus<EventMap>(config?.events);
    const requests = createRequestManager(bus);
    const extensions: AnyExtensionDefinition[] = [];
    const flows = new Map<string, AnyFlowDefinition>();

    const installExtension = (extension: AnyExtensionDefinition): void => {
        if (extensions.some((registered) => registered.name === extension.name)) {
            throw new DuplicateExtensionError(extension.name);
        }
        extensions.push(extension);
    };

    const installFlow = (flow: AnyFlowDefinition): void => {
        if (flows.has(flow.name)) {
            throw new DuplicateFlowError(flow.name);
        }
        flows.set(flow.name, flow);
    };

    const engine: AnyEngine = {
        bus,

        flows() {
            return [...flows.keys()];
        },

        getFlow(name: string) {
            const registered = flows.get(name);
            if (!registered) {
                throw new FlowNotRegisteredError(name);
            }
            return createRunnable(registered, extensions, bus, requests);
        },

        register(flow: AnyFlowDefinition) {
            installFlow(flow);
            return createRunnable(flow, extensions, bus, requests);
        },

        requests,

        run(flow: AnyFlowDefinition, ...args: AnyRunArgs) {
            return createRunnable(flow, extensions, bus, requests).run(...args);
        },

        start(flow: AnyFlowDefinition, ...args: AnyRunArgs) {
            return createRunnable(flow, extensions, bus, requests).start(...args);
        },

        use(definition: AnyExtensionDefinition) {
            installExtension(definition);
            return engine;
        },
    };

    return engine;
}

export type InferEngine<T extends AnyEngine> =
    T extends Engine<infer TProvided, infer TPublicEvents, infer TAllEvents>
        ? { AllEvents: TAllEvents; Provided: TProvided; PublicEvents: TPublicEvents }
        : never;

export type EngineEvents<TEngine extends AnyEngine> = InferEngine<TEngine>["AllEvents"];
