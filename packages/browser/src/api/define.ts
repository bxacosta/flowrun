import {
    flow as coreFlow,
    shape as coreShape,
    type EmptyObject,
    type EventMap,
    type FlowBuilder,
    type Shape,
    type ShapeFactory,
} from "@flowrun/core";

import { createBrowserExtension } from "../extension/browser-extension.ts";
import type { BrowserEventPayloads, BrowserProvidedContext } from "../extension/types.ts";
import { newPage } from "../resources/new-page.ts";
import { newSession } from "../resources/new-session.ts";

export type { NewPageOptions } from "../resources/new-page.ts";
export type { NewSessionOptions } from "../resources/new-session.ts";

export interface BrowserShape extends Shape {
    events: BrowserEventPayloads;
    provided: BrowserProvidedContext;
}

type WithBrowser<TShape extends Shape> = Omit<TShape, "events" | "provided"> & {
    events: BrowserEventPayloads & (TShape extends { events: infer E extends EventMap } ? E : EmptyObject);
    provided: BrowserProvidedContext & (TShape extends { provided: infer P extends object } ? P : EmptyObject);
};

function browserFlow(name: string): FlowBuilder<BrowserShape> {
    return coreFlow(name) as unknown as FlowBuilder<BrowserShape>;
}

function browserShape<TShape extends Shape = BrowserShape>(): ShapeFactory<WithBrowser<TShape>> {
    return coreShape<WithBrowser<TShape>>();
}

export const browser = {
    extension: createBrowserExtension,
    flow: browserFlow,
    newPage,
    newSession,
    shape: browserShape,
} as const;
