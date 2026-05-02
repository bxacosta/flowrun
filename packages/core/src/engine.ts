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
import type {
    AnyModuleDefinition,
    ModuleDefinition,
    ModuleInternalEvents,
    ModuleProvided,
    ModulePublicEvents,
} from "./module.ts";
import type { AnyScope } from "./scope.ts";
import type { EmptyObject, MergeObjects } from "./utils.ts";

type CompatibleFlow<TProvided extends object, TScope extends AnyScope> = TProvided extends TScope["_provided"]
    ? FlowDefinition<TScope>
    : never;

export interface EngineConfig {
    events?: EventBusConfig;
}

export interface Engine<TProvided extends object, TPublicEvents extends EventMap, TAllEvents extends EventMap> {
    bus: ReadableBus<TAllEvents>;

    flow(name: string): Flow<Record<string, unknown>, Record<string, unknown>>;

    flows(): readonly string[];

    register<TScope extends AnyScope>(
        flow: CompatibleFlow<TProvided, TScope>
    ): Flow<TScope["_params"], TScope["_state"]>;

    run<TScope extends AnyScope>(
        flow: CompatibleFlow<TProvided, TScope>,
        ...args: RunArgs<TScope["_params"]>
    ): Promise<FlowResult<TScope["_state"]>>;

    start<TScope extends AnyScope>(
        flow: CompatibleFlow<TProvided, TScope>,
        ...args: RunArgs<TScope["_params"]>
    ): Promise<FlowHandle<TScope["_state"]>>;

    use<TExtension extends ExtensionDefinition<object, object, object>>(
        extension: TExtension
    ): Engine<
        MergeObjects<TProvided, ExtensionProvided<TExtension>>,
        MergePublicEvents<TPublicEvents, ExtensionPublicEvents<TExtension>>,
        MergeAllEvents<TAllEvents, ExtensionInternalEvents<TExtension>, ExtensionPublicEvents<TExtension>>
    >;

    use<TModule extends ModuleDefinition<object, object, object>>(
        module: TModule
    ): Engine<
        MergeObjects<TProvided, ModuleProvided<TModule>>,
        MergePublicEvents<TPublicEvents, ModulePublicEvents<TModule>>,
        MergeAllEvents<TAllEvents, ModuleInternalEvents<TModule>, ModulePublicEvents<TModule>>
    >;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased engine implementation with typed public facade
type AnyEngine = Engine<any, any, any>;

function createRunnable(
    flow: AnyFlowDefinition,
    extensions: readonly AnyExtensionDefinition[],
    bus: ReturnType<typeof createEventBus<EventMap>>
): AnyFlow {
    const buildArgs = (args: AnyRunArgs) => ({
        bus,
        extensions,
        flow,
        params: args[0] ?? {},
    });

    return {
        name: flow.name,
        run: (...args: AnyRunArgs) => runFlow(buildArgs(args)),
        start: (...args: AnyRunArgs) => startFlow(buildArgs(args)),
    };
}

export function createEngine(config?: EngineConfig): Engine<EmptyObject, SystemPublicEvents, SystemEvents> {
    const bus = createEventBus<EventMap>(config?.events);
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

        flow(name: string) {
            const registered = flows.get(name);
            if (!registered) {
                throw new FlowNotRegisteredError(name);
            }
            return createRunnable(registered, extensions, bus);
        },

        flows() {
            return [...flows.keys()];
        },

        register(flow: AnyFlowDefinition) {
            installFlow(flow);
            return createRunnable(flow, extensions, bus);
        },

        run(flow: AnyFlowDefinition, ...args: AnyRunArgs) {
            return createRunnable(flow, extensions, bus).run(...args);
        },

        start(flow: AnyFlowDefinition, ...args: AnyRunArgs) {
            return createRunnable(flow, extensions, bus).start(...args);
        },

        use(definition: AnyExtensionDefinition | AnyModuleDefinition) {
            if (definition.kind === "module") {
                for (const extension of definition.extensions) {
                    installExtension(extension);
                }
                for (const flow of definition.flows) {
                    installFlow(flow);
                }
                return engine;
            }
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
