/**
 * definition/extension.ts — Extension definition & markers
 *
 * Layer: L3 (definition). The `extension()` factory plus the `requires()` type
 * marker. An extension declares the event tokens it may emit and the context it
 * requires from extensions installed before it.
 */

import type { Outcome } from "../core/status.ts";
import type { EmptyObject, MaybePromise } from "../core/types.ts";
import { assertValidName } from "../core/validation.ts";
import type { Logger } from "../events/logger.ts";
import type { AnyEventToken, EmitFn, EventSubscriber } from "../events/types.ts";

declare const requiredBrand: unique symbol;

// ── Markers ─────────────────────────────────────────────────────────

export interface RequiresMarker<TRequired extends object> {
    readonly [requiredBrand]: TRequired;
}

export function requires<TRequired extends object>(): RequiresMarker<TRequired> {
    return undefined as unknown as RequiresMarker<TRequired>;
}

export type UnwrapRequires<TMarker> = TMarker extends RequiresMarker<infer TRequired> ? TRequired : EmptyObject;

// ── Setup contract ──────────────────────────────────────────────────

export type ExtensionDispose = (outcome: Outcome) => MaybePromise<void>;

export interface ExtensionSetupResult<TContext extends object> {
    dispose?: ExtensionDispose;
    provided?: TContext;
}

export interface ExtensionSetupContext<TRequired extends object, TEmit extends AnyEventToken> {
    emit: EmitFn<TEmit>;
    flowName: string;
    history: EventSubscriber["history"];
    log: Logger;
    on: EventSubscriber["on"];
    provided: TRequired;
    runId: string;
    signal: AbortSignal;
    waitFor: EventSubscriber["waitFor"];
}

export interface ExtensionConfig<
    TName extends string,
    TRequires extends RequiresMarker<object> | undefined,
    TEvents extends readonly AnyEventToken[],
    TContext extends object,
> {
    events?: TEvents;
    name: TName;
    requires?: TRequires;
    setup: (
        context: ExtensionSetupContext<UnwrapRequires<TRequires>, TEvents[number]>
    ) => MaybePromise<ExtensionSetupResult<TContext>>;
}

export interface ExtensionDefinition<TRequired extends object = EmptyObject, TContext extends object = EmptyObject> {
    readonly _context?: TContext;
    readonly _required?: TRequired;
    readonly name: string;
    readonly setup: AnyExtensionSetup;
    readonly type: "extension";
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased extension for runtime registries
export type AnyExtensionDefinition = ExtensionDefinition<any, any>;

// biome-ignore lint/suspicious/noExplicitAny: typed at the extension factory boundary
export type AnyExtensionSetup = (context: any) => MaybePromise<ExtensionSetupResult<object>>;

export type ExtensionRequired<TDefinition> =
    TDefinition extends ExtensionDefinition<infer TRequired, object> ? TRequired : EmptyObject;

export type ExtensionProvided<TDefinition> =
    TDefinition extends ExtensionDefinition<object, infer TContext> ? TContext : EmptyObject;

// ── Factory ─────────────────────────────────────────────────────────

export function extension<
    const TName extends string,
    TRequires extends RequiresMarker<object> | undefined,
    TEvents extends readonly AnyEventToken[] = readonly [],
    TContext extends object = EmptyObject,
>(
    config: ExtensionConfig<TName, TRequires, TEvents, TContext>
): ExtensionDefinition<UnwrapRequires<TRequires>, TContext> {
    assertValidName("extension", config.name);
    return {
        type: "extension",
        name: config.name,
        setup: config.setup as AnyExtensionSetup,
    };
}
