import { FlowEngineError } from "./errors.ts";
import type { EventBusConfig, ReadableBus } from "./event-bus.ts";
import { createEventBus } from "./event-bus.ts";
import type { AllSystemEvents, EventMap, MergeAllEvents, MergePublicEvents, SystemPublicEvents } from "./events.ts";
import type { AnyExtension, Extension } from "./extension.ts";
import { createFlow } from "./flow-builder.ts";
import type { AnyFlow, AnyScope, EmptyObject, Flow, FlowDefinition, FlowResult, Scope } from "./types.ts";

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
        definition: FlowDefinition<Scope<TProvided, TParams, TState, TPublicEvents, TAllEvents>>
    ): Flow<TParams, TState>;

    flow<TFlowScope extends AnyScope>(
        id: string,
        definition: TProvided extends TFlowScope["_provided"] ? FlowDefinition<TFlowScope> : never
    ): Flow<TFlowScope["_params"], TFlowScope["_state"]>;

    flows(): readonly string[];

    run(id: string, params?: Record<string, unknown>): Promise<FlowResult<Record<string, unknown>>>;
}

// ── Engine Type Inference ─────────────────────────────────────────────

export type FlowScope<
    TEngine extends AnyEngine,
    TParams extends Record<string, unknown> = EmptyObject,
    TState extends Record<string, unknown> = EmptyObject,
> =
    TEngine extends Engine<infer TProvided, infer TPublicEvents, infer TAllEvents>
        ? Scope<TProvided, TParams, TState, TPublicEvents, TAllEvents>
        : never;

export type InferEngine<T extends AnyEngine> =
    T extends Engine<infer TProvided, infer TPublicEvents, infer TAllEvents>
        ? { AllEvents: TAllEvents; Provided: TProvided; PublicEvents: TPublicEvents }
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

        flow(id: string, definition: FlowDefinition<Scope>) {
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
