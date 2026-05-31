/**
 * definition/extension.ts — Extension definition & markers
 *
 * Layer: L3 (definition). The `extension()` factory plus the `event()` and
 * `requires()` type markers used to declare an extension's public events and
 * its required (provided-by-others) context.
 */

import type { Outcome } from "../core/status.ts";
import type { EmptyObject, MaybePromise } from "../core/types.ts";
import { assertValidName, assertValidTopicKey } from "../core/validation.ts";
import type { Logger } from "../events/logger.ts";
import type { EmitFn, EventMap, EventSubscriber, RuntimeEvents } from "../events/types.ts";

declare const eventPayloadBrand: unique symbol;
declare const requiredBrand: unique symbol;

// ── Markers ─────────────────────────────────────────────────────────

export interface EventMarker<TPayload = unknown> {
    readonly [eventPayloadBrand]: TPayload;
}

export function event<TPayload = undefined>(): EventMarker<TPayload> {
    return undefined as unknown as EventMarker<TPayload>;
}

export type EventDefinitions = Record<string, EventMarker>;

export interface RequiresMarker<TRequired extends object> {
    readonly [requiredBrand]: TRequired;
}

export function requires<TRequired extends object>(): RequiresMarker<TRequired> {
    return undefined as unknown as RequiresMarker<TRequired>;
}

// ── Type derivation ─────────────────────────────────────────────────

export type UnwrapRequires<TMarker> = TMarker extends RequiresMarker<infer TRequired> ? TRequired : EmptyObject;

export type UnwrapEvents<TDefinitions extends EventDefinitions> = {
    [K in keyof TDefinitions & string]: TDefinitions[K] extends EventMarker<infer P> ? P : never;
};

export type Prefixed<TName extends string, TEvents extends EventMap> = {
    [K in keyof TEvents & string as `${TName}:${K}`]: TEvents[K];
};

// ── Setup contract ──────────────────────────────────────────────────

export type ExtensionDispose = (outcome: Outcome) => MaybePromise<void>;

export interface ExtensionSetupResult<TContext extends object> {
    dispose?: ExtensionDispose;
    provided?: TContext;
}

export interface ExtensionSetupContext<
    TRequired extends object,
    TOwnShortEvents extends EventMap,
    TAllEvents extends EventMap,
> {
    emit: EmitFn<TOwnShortEvents>;
    flowName: string;
    history: EventSubscriber<TAllEvents>["history"];
    log: Logger;
    on: EventSubscriber<TAllEvents>["on"];
    provided: TRequired;
    runId: string;
    signal: AbortSignal;
    waitFor: EventSubscriber<TAllEvents>["waitFor"];
}

export interface ExtensionConfig<
    TName extends string,
    TRequires extends RequiresMarker<object> | undefined,
    TEvents extends EventDefinitions,
    TContext extends object,
> {
    events?: TEvents;
    name: TName;
    requires?: TRequires;
    setup: (
        context: ExtensionSetupContext<
            UnwrapRequires<TRequires>,
            UnwrapEvents<TEvents>,
            RuntimeEvents & Prefixed<TName, UnwrapEvents<TEvents>>
        >
    ) => MaybePromise<ExtensionSetupResult<TContext>>;
}

export interface ExtensionDefinition<
    TRequired extends object = EmptyObject,
    TContext extends object = EmptyObject,
    TEvents extends EventMap = EmptyObject,
> {
    readonly _context?: TContext;
    readonly _events?: TEvents;
    readonly _required?: TRequired;
    readonly name: string;
    readonly setup: AnyExtensionSetup;
    readonly type: "extension";
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased extension for runtime registries
export type AnyExtensionDefinition = ExtensionDefinition<any, any, any>;

// biome-ignore lint/suspicious/noExplicitAny: typed at the extension factory boundary
export type AnyExtensionSetup = (context: any) => MaybePromise<ExtensionSetupResult<object>>;

export type ExtensionRequired<TDefinition> =
    TDefinition extends ExtensionDefinition<infer TRequired, object, EventMap> ? TRequired : EmptyObject;

export type ExtensionProvided<TDefinition> =
    TDefinition extends ExtensionDefinition<object, infer TContext, EventMap> ? TContext : EmptyObject;

export type ExtensionEvents<TDefinition> =
    TDefinition extends ExtensionDefinition<object, object, infer TEvents> ? TEvents : EmptyObject;

// ── Factory ─────────────────────────────────────────────────────────

export function extension<
    const TName extends string,
    TRequires extends RequiresMarker<object> | undefined,
    TEvents extends EventDefinitions,
    TContext extends object,
>(
    config: ExtensionConfig<TName, TRequires, TEvents, TContext>
): ExtensionDefinition<UnwrapRequires<TRequires>, TContext, Prefixed<TName, UnwrapEvents<TEvents>>> {
    assertValidName("extension", config.name);
    if (config.events) {
        for (const key of Object.keys(config.events)) {
            assertValidTopicKey(key);
        }
    }
    return {
        type: "extension",
        name: config.name,
        setup: config.setup as AnyExtensionSetup,
    };
}
