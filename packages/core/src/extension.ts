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

function publicEvent<TPayload>(): Public<TPayload> {
    return undefined as unknown as Public<TPayload>;
}

function internalEvent<TPayload>(): Internal<TPayload> {
    return undefined as unknown as Internal<TPayload>;
}

export const event = {
    internal: internalEvent,
    public: publicEvent,
} as const;

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

export interface ExtensionSetupContext<TEvents extends EventMap> {
    bus: PublishableBus<SystemPublicEvents & TEvents, SystemEvents & TEvents>;
    flowName: string;
    log: Logger;
    runId: string;
}

export type ExtensionCleanupContext<TProvided extends object, TEvents extends EventMap> = TProvided &
    ExtensionSetupContext<TEvents>;

export interface ExtensionResourceConfig<TDefinitions extends EventDefinitions, TProvided extends object> {
    cleanup?: (context: ExtensionCleanupContext<TProvided, UnwrapEvents<TDefinitions>>) => MaybePromise<void>;
    provide: (context: ExtensionSetupContext<UnwrapEvents<TDefinitions>>) => MaybePromise<TProvided>;
}

export interface ExtensionConfig<TDefinitions extends EventDefinitions, TProvided extends object> {
    events?: TDefinitions;
    name: string;
    resource: ExtensionResourceConfig<TDefinitions, TProvided>;
}

export interface ExtensionResource {
    cleanup?: AnyExtensionCleanup;
    provide: AnyExtensionProvide;
}

export interface ExtensionDefinition<
    TProvided extends object = EmptyObject,
    TInternalEvents extends object = EmptyObject,
    TPublicEvents extends object = EmptyObject,
> {
    readonly _internalEvents?: TInternalEvents;
    readonly _provided?: TProvided;
    readonly _publicEvents?: TPublicEvents;
    readonly kind: "extension";
    readonly name: string;
    readonly resource: ExtensionResource;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased extension for runtime registries
export type AnyExtensionDefinition = ExtensionDefinition<any, any, any>;

// biome-ignore lint/suspicious/noExplicitAny: typed at define.extension boundary
export type AnyExtensionCleanup = (context: any) => MaybePromise<void>;

// biome-ignore lint/suspicious/noExplicitAny: typed at define.extension boundary
export type AnyExtensionProvide = (context: any) => MaybePromise<object>;

export type ExtensionProvided<TDefinition> =
    TDefinition extends ExtensionDefinition<infer TProvided, object, object> ? TProvided : EmptyObject;

export type ExtensionInternalEvents<TDefinition> =
    TDefinition extends ExtensionDefinition<object, infer TInternal, object> ? AsEventMap<TInternal> : EmptyObject;

export type ExtensionPublicEvents<TDefinition> =
    TDefinition extends ExtensionDefinition<object, object, infer TPublic> ? AsEventMap<TPublic> : EmptyObject;
