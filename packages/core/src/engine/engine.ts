/**
 * engine/engine.ts — Engine facade
 *
 * Layer: L4 (engine). Holds the event bus, request manager, extension chain and
 * flow registry, and exposes the typed run/start/register/use surface. Owns the
 * registry errors it can raise.
 */

import { FlowEngineError } from "../core/errors.ts";
import type { EmptyObject, MergeObjects } from "../core/types.ts";
import type {
    AnyExtensionDefinition,
    ExtensionDefinition,
    ExtensionProvided,
    ExtensionRequired,
} from "../definition/extension.ts";
import type { AnyFlowDefinition, FlowDefinition } from "../definition/flow.ts";
import type { EngineRequests } from "../definition/request.ts";
import { createEventBus, type EventBusConfig } from "../events/bus.ts";
import type { EventSubscriber } from "../events/types.ts";
import type { ParamsOf, ProvidedOf, Shape, StateOf } from "../shape/shape.ts";
import {
    type AnyFlow,
    type AnyRunArgs,
    type Flow,
    type FlowHandle,
    type RunArgs,
    runFlow,
    startFlow,
} from "./flow-runner.ts";
import { createRequestManager } from "./request-manager.ts";
import type { FlowResult } from "./results.ts";

// ── Errors ──────────────────────────────────────────────────────────

export class DuplicateFlowError extends FlowEngineError {
    override readonly name = "DuplicateFlowError";

    constructor(flowName: string) {
        super(`Flow "${flowName}" is already registered`);
    }
}

export class DuplicateExtensionError extends FlowEngineError {
    override readonly name = "DuplicateExtensionError";

    constructor(extensionName: string) {
        super(`Extension "${extensionName}" is already registered`);
    }
}

export class FlowNotRegisteredError extends FlowEngineError {
    override readonly name = "FlowNotRegisteredError";

    constructor(flowName: string) {
        super(`Flow "${flowName}" is not registered`);
    }
}

// ── Compatibility typing ────────────────────────────────────────────

type CompatibleFlow<TProvided extends object, TShape extends Shape> =
    TProvided extends ProvidedOf<TShape> ? FlowDefinition<TShape> : never;

declare const missingExtensionDependencyBrand: unique symbol;

export interface MissingExtensionDependency<TMissing extends string> {
    readonly [missingExtensionDependencyBrand]: `extension requires "${TMissing}" in provided context, but no prior .use() supplied it`;
}

type MissingDependencyKeys<TExtension extends AnyExtensionDefinition, TProvided extends object> = Exclude<
    keyof ExtensionRequired<TExtension>,
    keyof TProvided
> &
    string;

type CompatibleExtension<TExtension extends AnyExtensionDefinition, TProvided extends object> = [
    MissingDependencyKeys<TExtension, TProvided>,
] extends [never]
    ? TExtension
    : MissingExtensionDependency<MissingDependencyKeys<TExtension, TProvided>>;

// ── Engine interface ────────────────────────────────────────────────

export interface EngineConfig {
    events?: EventBusConfig;
}

export interface Engine<TProvided extends object> {
    readonly events: EventSubscriber;

    flows(): readonly string[];

    getFlow(name: string): Flow<object, Record<string, unknown>>;

    register<TShape extends Shape>(flow: CompatibleFlow<TProvided, TShape>): Flow<ParamsOf<TShape>, StateOf<TShape>>;

    readonly requests: EngineRequests;

    run<TShape extends Shape>(
        flow: CompatibleFlow<TProvided, TShape>,
        ...args: RunArgs<ParamsOf<TShape>>
    ): Promise<FlowResult<StateOf<TShape>>>;

    start<TShape extends Shape>(
        flow: CompatibleFlow<TProvided, TShape>,
        ...args: RunArgs<ParamsOf<TShape>>
    ): Promise<FlowHandle<StateOf<TShape>>>;

    use<TExtension extends ExtensionDefinition<object, object>>(
        extension: CompatibleExtension<TExtension, TProvided>
    ): Engine<MergeObjects<TProvided, ExtensionProvided<TExtension>>>;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased engine implementation with typed public facade
type AnyEngine = Engine<any>;

// ── Factory ─────────────────────────────────────────────────────────

function createRunnable(
    flow: AnyFlowDefinition,
    extensions: readonly AnyExtensionDefinition[],
    bus: ReturnType<typeof createEventBus>,
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

export function createEngine(config?: EngineConfig): Engine<EmptyObject> {
    const bus = createEventBus(config?.events);
    const requests = createRequestManager(bus, config?.events?.onError);
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
        events: bus.asReadable(),

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

        use(definition: AnyExtensionDefinition | MissingExtensionDependency<string>) {
            installExtension(definition as AnyExtensionDefinition);
            return engine;
        },
    };

    return engine;
}

export type InferEngine<T extends AnyEngine> = T extends Engine<infer TProvided> ? { Provided: TProvided } : never;
