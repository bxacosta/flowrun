import { FlowEngineError } from "./errors.ts";
import type { EventBusConfig } from "./event-bus.ts";
import { createEventBus } from "./event-bus.ts";
import type { AnyExtension, Extension } from "./extension.ts";
import { createFlow } from "./flow-builder.ts";
import type {
    AllSystemEvents,
    AnyFlow,
    EmptyObject,
    EventMap,
    Flow,
    FlowContext,
    FlowDefinition,
    FlowMiddleware,
    FlowResult,
    MergeAllEvents,
    MergePublicEvents,
    NodeBuilder,
    ParallelNodeConfig,
    ReadableBus,
    SystemPublicEvents,
    TaskContext,
    TaskMiddleware,
    TaskNodeConfig,
} from "./types.ts";

// ── Engine Interface ──────────────────────────────────────────────────

export interface Engine<
    TProvided extends Record<string, unknown>,
    TPublicEvents extends EventMap,
    TAllEvents extends EventMap,
> {
    bus: ReadableBus<TAllEvents>;

    extend<
        TExtensionProvided extends Record<string, unknown>,
        TExtensionInternal extends object = EmptyObject,
        TExtensionPublic extends object = EmptyObject,
    >(
        extension: Extension<TExtensionProvided, TExtensionInternal, TExtensionPublic>
    ): Engine<
        TProvided & TExtensionProvided,
        MergePublicEvents<TPublicEvents, TExtensionPublic>,
        MergeAllEvents<TAllEvents, TExtensionInternal, TExtensionPublic>
    >;

    flow<TParams extends Record<string, unknown> = EmptyObject, TState extends Record<string, unknown> = EmptyObject>(
        id: string,
        definition: FlowDefinition<TProvided, TParams, TState, TPublicEvents, TAllEvents>
    ): Flow<TParams, TState>;

    flows(): readonly string[];

    register<TFlowParams extends Record<string, unknown>, TFlowState extends Record<string, unknown>>(
        flow: Flow<TFlowParams, TFlowState>
    ): Engine<TProvided, TPublicEvents, TAllEvents>;

    run(id: string, params?: Record<string, unknown>): Promise<FlowResult<Record<string, unknown>>>;
}

// ── Engine Type Inference ─────────────────────────────────────────────

export type InferEngine<T extends AnyEngine> =
    T extends Engine<infer TProvided, infer TPublicEvents, infer TAllEvents>
        ? { AllEvents: TAllEvents; Provided: TProvided; PublicEvents: TPublicEvents }
        : never;

export type FlowTypes<
    TEngine extends AnyEngine,
    TParams extends Record<string, unknown> = EmptyObject,
    TState extends Record<string, unknown> = EmptyObject,
> =
    TEngine extends Engine<infer TProvided, infer TPublicEvents, infer TAllEvents>
        ? {
              Builder: NodeBuilder<TProvided, TParams, TState, TPublicEvents, TAllEvents>;
              FlowContext: FlowContext<TProvided, TParams, TState, TPublicEvents, TAllEvents>;
              FlowMiddleware: FlowMiddleware<TProvided, TParams, TState, TPublicEvents, TAllEvents>;
              ParallelConfig: ParallelNodeConfig<TProvided, TParams, TState, TPublicEvents, TAllEvents>;
              TaskConfig: TaskNodeConfig<TProvided, TParams, TState, TPublicEvents, TAllEvents>;
              TaskContext: TaskContext<TProvided, TParams, TState, TPublicEvents, TAllEvents>;
              TaskMiddleware: TaskMiddleware<TProvided, TParams, TState, TPublicEvents, TAllEvents>;
          }
        : never;

// ── Type-Erased Aliases ─────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: type-erased engine — public Engine interface provides type safety
type AnyEngine = Engine<any, any, any>;

// ── Implementation ────────────────────────────────────────────────────

export function createEngine(busConfig?: EventBusConfig): Engine<EmptyObject, SystemPublicEvents, AllSystemEvents> {
    const registry = new Map<string, AnyFlow>();
    const extensions: AnyExtension[] = [];
    const bus = createEventBus<EventMap>(busConfig);

    const engine: AnyEngine = {
        bus,

        extend(extension) {
            if (extensions.some((registered) => registered.name === extension.name)) {
                throw new FlowEngineError(`Extension "${extension.name}" already registered`);
            }
            extensions.push(extension);
            return engine;
        },

        flow(id, definition) {
            if (registry.has(id)) {
                throw new FlowEngineError(`Flow "${id}" is already registered`);
            }
            const createdFlow = createFlow(id, definition, extensions, bus);
            registry.set(id, createdFlow);
            return createdFlow;
        },

        flows() {
            return [...registry.keys()];
        },

        register(flow) {
            if (registry.has(flow.id)) {
                throw new FlowEngineError(`Flow "${flow.id}" is already registered`);
            }
            registry.set(flow.id, flow);
            return engine;
        },

        run(id, params = {}) {
            const flow = registry.get(id);
            if (flow === undefined) {
                throw new FlowEngineError(`Flow "${id}" is not registered`);
            }
            return flow.run(params);
        },
    };

    return engine;
}
