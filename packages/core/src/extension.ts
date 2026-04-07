import type { PublishableBus } from "./event-bus.ts";
import type { AsEventMap, EventMap, SystemEvents, SystemPublicEvents } from "./events.ts";
import type { Logger } from "./logger.ts";
import type { EmptyObject } from "./types.ts";

// ── Visibility Markers ────────────────────────────────────────────────

declare const __visibility: unique symbol;

export interface Internal<TPayload> {
    readonly _type: TPayload;
    readonly [__visibility]: "internal";
}

export interface Event<TPayload> {
    readonly _type: TPayload;
    readonly [__visibility]: "event";
}

export type EventMarker = Event<unknown> | Internal<unknown>;
export type EventDefinitions = Record<string, EventMarker>;

export function internal<TPayload>(): Internal<TPayload> {
    return undefined as unknown as Internal<TPayload>;
}

export function event<TPayload>(): Event<TPayload> {
    return undefined as unknown as Event<TPayload>;
}

// ── Visibility Extraction ─────────────────────────────────────────────

type ExtractByVisibility<TDefinitions extends EventDefinitions, TVisibility extends string> = {
    [K in keyof TDefinitions as TDefinitions[K] extends { [__visibility]: TVisibility }
        ? K
        : never]: TDefinitions[K] extends { _type: infer TPayload } ? TPayload : never;
};

export type ExtractInternalEvents<TDefinitions extends EventDefinitions> = ExtractByVisibility<
    TDefinitions,
    "internal"
>;
export type ExtractPublicEvents<TDefinitions extends EventDefinitions> = ExtractByVisibility<TDefinitions, "event">;

export type UnwrapEvents<TDefinitions extends EventDefinitions> = {
    [K in keyof TDefinitions & string]: TDefinitions[K] extends { _type: infer TPayload } ? TPayload : never;
};

// ── Extension Context ─────────────────────────────────────────────────

export interface ExtensionContext<TEvents extends EventMap> {
    bus: PublishableBus<SystemPublicEvents & TEvents, SystemEvents & TEvents>;
    flowId: string;
    log: Logger;
    runId: string;
}

// ── Extension Types ───────────────────────────────────────────────────

export interface ExtensionConfig<TDefinitions extends EventDefinitions, TProvided extends object> {
    create: (context: ExtensionContext<UnwrapEvents<TDefinitions>>) => TProvided;
    dispose?: (provided: TProvided) => Promise<void> | void;
    events: TDefinitions;
    name: string;
}

export interface Extension<
    TProvided extends object = EmptyObject,
    TInternalEvents extends object = EmptyObject,
    TPublicEvents extends object = EmptyObject,
> {
    create: (context: ExtensionContext<AsEventMap<TInternalEvents & TPublicEvents>>) => TProvided;
    dispose?: (provided: TProvided) => Promise<void> | void;
    name: string;
}

// ── Type-Erased Aliases ─────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: type-erased extension reference — typed at Engine.extend() boundary
export type AnyExtension = Extension<any, any, any>;

// ── defineExtension ───────────────────────────────────────────────────

export function defineExtension<TDefinitions extends EventDefinitions, TProvided extends object>(
    config: ExtensionConfig<TDefinitions, TProvided>
): Extension<TProvided, ExtractInternalEvents<TDefinitions>, ExtractPublicEvents<TDefinitions>> {
    return {
        create: config.create as unknown as AnyExtension["create"],
        dispose: config.dispose,
        name: config.name,
    };
}
