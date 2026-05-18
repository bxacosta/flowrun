import {
    define,
    type EmptyObject,
    type FlowConfig,
    type FlowDefinition,
    type Scope,
    type ScopeContract,
    type ScopeFromContract,
    type SystemEvents,
    type SystemPublicEvents,
} from "@flowrun/core";

import { type BrowserExtensionDefinition, createBrowserExtension } from "../extension/browser-extension.ts";
import type { BrowserEventPayloads, BrowserExtensionConfig, BrowserProvidedContext } from "../extension/types.ts";
import { newPage } from "../resources/new-page.ts";
import { newSession } from "../resources/new-session.ts";

export type { NewPageOptions } from "../resources/new-page.ts";
export type { NewSessionOptions } from "../resources/new-session.ts";

type BrowserPublicEvents = SystemPublicEvents & BrowserEventPayloads;
type BrowserAllEvents = SystemEvents & BrowserEventPayloads;

export type BrowserRootScope<TParams extends object, TState extends object> = Scope<
    BrowserProvidedContext,
    TParams,
    TState,
    BrowserPublicEvents,
    BrowserAllEvents
>;

export type BrowserScope<TContract extends ScopeContract> = Scope<
    BrowserProvidedContext & ScopeFromContract<TContract>["_provided"],
    ScopeFromContract<TContract>["_params"],
    ScopeFromContract<TContract>["_state"],
    BrowserPublicEvents & ScopeFromContract<TContract>["_publicEvents"],
    BrowserAllEvents & ScopeFromContract<TContract>["_allEvents"]
>;

function browserFlow<TParams extends object = EmptyObject, TState extends object = EmptyObject>(
    config: FlowConfig<BrowserRootScope<TParams, TState>>
): FlowDefinition<BrowserRootScope<TParams, TState>> {
    const scoped = define.scope<{
        params: TParams;
        state: TState;
        provided: BrowserProvidedContext;
        events: BrowserEventPayloads;
    }>();
    return scoped.flow(
        config as FlowConfig<
            ScopeFromContract<{
                params: TParams;
                state: TState;
                provided: BrowserProvidedContext;
                events: BrowserEventPayloads;
            }>
        >
    ) as FlowDefinition<BrowserRootScope<TParams, TState>>;
}

interface MergedContract<TContract extends ScopeContract> {
    events: BrowserEventPayloads & NonNullable<TContract["events"]>;
    internalEvents: TContract["internalEvents"];
    params: TContract["params"];
    provided: BrowserProvidedContext & NonNullable<TContract["provided"]>;
    state: TContract["state"];
}

function browserScope<TContract extends ScopeContract = EmptyObject>(): ReturnType<
    typeof define.scope<MergedContract<TContract>>
> {
    return define.scope<MergedContract<TContract>>();
}

function browserExtension(config: BrowserExtensionConfig): BrowserExtensionDefinition {
    return createBrowserExtension(config);
}

export const browser = {
    flow: browserFlow,
    scope: browserScope,
    extension: browserExtension,
    newPage,
    newSession,
} as const;
