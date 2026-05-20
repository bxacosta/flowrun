import type { AsEventMap } from "./events.ts";
import type { AnyExtensionDefinition } from "./extension.ts";
import type { AnyFlowDefinition } from "./flow-runner.ts";
import type { EmptyObject, Simplify } from "./utils.ts";

export interface ModuleConfig<
    TExtensions extends readonly AnyExtensionDefinition[],
    TFlows extends readonly AnyFlowDefinition[],
> {
    extensions?: TExtensions;
    flows?: TFlows;
    name: string;
}

export interface ModuleDefinition<
    TProvided extends object = EmptyObject,
    TInternalEvents extends object = EmptyObject,
    TPublicEvents extends object = EmptyObject,
> {
    readonly _internalEvents?: TInternalEvents;
    readonly _provided?: TProvided;
    readonly _publicEvents?: TPublicEvents;
    readonly extensions: readonly AnyExtensionDefinition[];
    readonly flows: readonly AnyFlowDefinition[];
    readonly kind: "module";
    readonly name: string;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased module for engine.use
export type AnyModuleDefinition = ModuleDefinition<any, any, any>;

export type ModuleProvided<TDefinition> =
    TDefinition extends ModuleDefinition<infer TProvided, object, object> ? TProvided : EmptyObject;

export type ModuleInternalEvents<TDefinition> =
    TDefinition extends ModuleDefinition<object, infer TInternal, object> ? AsEventMap<TInternal> : EmptyObject;

export type ModulePublicEvents<TDefinition> =
    TDefinition extends ModuleDefinition<object, object, infer TPublic> ? AsEventMap<TPublic> : EmptyObject;

type UnionToIntersection<TUnion> = (TUnion extends unknown ? (value: TUnion) => void : never) extends (
    value: infer TIntersection
) => void
    ? TIntersection
    : never;

type MergeExtensionProvided<TExtensions extends readonly AnyExtensionDefinition[]> = Simplify<
    UnionToIntersection<
        TExtensions[number] extends infer TExtension
            ? TExtension extends { readonly _provided?: infer TProvided extends object }
                ? TProvided
                : EmptyObject
            : never
    >
>;

type MergeExtensionInternalEvents<TExtensions extends readonly AnyExtensionDefinition[]> = Simplify<
    UnionToIntersection<
        TExtensions[number] extends infer TExtension
            ? TExtension extends { readonly _internalEvents?: infer TEvents extends object }
                ? TEvents
                : EmptyObject
            : never
    >
>;

type MergeExtensionPublicEvents<TExtensions extends readonly AnyExtensionDefinition[]> = Simplify<
    UnionToIntersection<
        TExtensions[number] extends infer TExtension
            ? TExtension extends { readonly _publicEvents?: infer TEvents extends object }
                ? TEvents
                : EmptyObject
            : never
    >
>;

export function defineModule<
    const TExtensions extends readonly AnyExtensionDefinition[] = readonly [],
    const TFlows extends readonly AnyFlowDefinition[] = readonly [],
>(
    config: ModuleConfig<TExtensions, TFlows>
): ModuleDefinition<
    MergeExtensionProvided<TExtensions>,
    MergeExtensionInternalEvents<TExtensions>,
    MergeExtensionPublicEvents<TExtensions>
> {
    return {
        extensions: config.extensions ?? [],
        flows: config.flows ?? [],
        kind: "module",
        name: config.name,
    };
}
