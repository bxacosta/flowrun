import type { PublishableBus } from "./event-bus.ts";
import type { AsEventMap, EventMap, SystemEvents, SystemPublicEvents } from "./events.ts";
import type { Logger } from "./logger.ts";
import type { EmptyObject, MaybePromise } from "./utils.ts";

declare const visibility: unique symbol;

export interface Internal<TPayload> {
    readonly _type: TPayload;
    readonly [visibility]: "internal";
}

export interface Public<TPayload> {
    readonly _type: TPayload;
    readonly [visibility]: "public";
}

export type EventMarker = Internal<unknown> | Public<unknown>;
export type EventDefinitions = Record<string, EventMarker>;

export function eventPublic<TPayload>(): Public<TPayload> {
    return undefined as unknown as Public<TPayload>;
}

export function eventInternal<TPayload>(): Internal<TPayload> {
    return undefined as unknown as Internal<TPayload>;
}

type ExtractByVisibility<TDefinitions extends EventDefinitions, TVisibility extends string> = {
    [K in keyof TDefinitions as TDefinitions[K] extends { [visibility]: TVisibility }
        ? K
        : never]: TDefinitions[K] extends { _type: infer TPayload } ? TPayload : never;
};

export type ExtractInternalEvents<TDefinitions extends EventDefinitions> = ExtractByVisibility<
    TDefinitions,
    "internal"
>;
export type ExtractPublicEvents<TDefinitions extends EventDefinitions> = ExtractByVisibility<TDefinitions, "public">;

export type UnwrapEvents<TDefinitions extends EventDefinitions> = {
    [K in keyof TDefinitions & string]: TDefinitions[K] extends { _type: infer TPayload } ? TPayload : never;
};

export interface FlowOutcome {
    error?: Error;
    reason?: string;
    status: "cancelled" | "failed" | "success";
}

export type ExtensionCleanup = (outcome: FlowOutcome) => MaybePromise<void>;

export interface ExtensionProvideResult<TProvided extends object> {
    cleanup?: ExtensionCleanup;
    provided?: TProvided;
}

export interface ExtensionSetupContext<TRequired extends object, TEvents extends EventMap> {
    bus: PublishableBus<SystemPublicEvents & TEvents, SystemEvents & TEvents>;
    flowName: string;
    log: Logger;
    provided: TRequired;
    runId: string;
    signal: AbortSignal;
}

export interface ExtensionConfig<
    TRequired extends object,
    TDefinitions extends EventDefinitions,
    TProvided extends object,
> {
    events?: TDefinitions;
    name: string;
    provide: (
        context: ExtensionSetupContext<TRequired, UnwrapEvents<TDefinitions>>
    ) => MaybePromise<ExtensionProvideResult<TProvided>>;
}

export interface ExtensionDefinition<
    TRequired extends object = EmptyObject,
    TProvided extends object = EmptyObject,
    TInternalEvents extends object = EmptyObject,
    TPublicEvents extends object = EmptyObject,
> {
    readonly _internalEvents?: TInternalEvents;
    readonly _provided?: TProvided;
    readonly _publicEvents?: TPublicEvents;
    readonly _required?: TRequired;
    readonly kind: "extension";
    readonly name: string;
    readonly provide: AnyExtensionProvide;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased extension for runtime registries
export type AnyExtensionDefinition = ExtensionDefinition<any, any, any, any>;

// biome-ignore lint/suspicious/noExplicitAny: typed at the extension factory boundary
export type AnyExtensionProvide = (context: any) => MaybePromise<ExtensionProvideResult<object>>;

export type ExtensionRequired<TDefinition> =
    TDefinition extends ExtensionDefinition<infer TRequired, object, object, object> ? TRequired : EmptyObject;

export type ExtensionProvided<TDefinition> =
    TDefinition extends ExtensionDefinition<object, infer TProvided, object, object> ? TProvided : EmptyObject;

export type ExtensionInternalEvents<TDefinition> =
    TDefinition extends ExtensionDefinition<object, object, infer TInternal, object>
        ? AsEventMap<TInternal>
        : EmptyObject;

export type ExtensionPublicEvents<TDefinition> =
    TDefinition extends ExtensionDefinition<object, object, object, infer TPublic> ? AsEventMap<TPublic> : EmptyObject;

export function extension<
    TRequired extends object = EmptyObject,
    TDefinitions extends EventDefinitions = EventDefinitions,
    TProvided extends object = EmptyObject,
>(
    config: ExtensionConfig<TRequired, TDefinitions, TProvided>
): ExtensionDefinition<TRequired, TProvided, ExtractInternalEvents<TDefinitions>, ExtractPublicEvents<TDefinitions>> {
    return {
        kind: "extension",
        name: config.name,
        provide: config.provide as AnyExtensionProvide,
    };
}
