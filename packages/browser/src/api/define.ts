import {
    flow as coreFlow,
    shape as coreShape,
    type FlowBuilder,
    type Shape,
    type ShapeFactory,
    type WithEvents,
    type WithProvided,
} from "@flowrun/core";

import { createBrowserExtension } from "../extension/browser/index.ts";
import type { BrowserEventPayloads, BrowserProvidedContext } from "../extension/browser/types.ts";
import { newPage } from "../resources/new-page.ts";
import { newSession } from "../resources/new-session.ts";

export type { NewPageOptions } from "../resources/new-page.ts";
export type { NewSessionOptions } from "../resources/new-session.ts";

export interface BrowserShape extends Shape {
    events: BrowserEventPayloads;
    provided: BrowserProvidedContext;
}

export type WithBrowser<TShape extends Shape = Shape> = WithProvided<
    WithEvents<TShape, BrowserEventPayloads>,
    BrowserProvidedContext
>;

function browserFlow(name: string): FlowBuilder<BrowserShape> {
    return coreFlow<BrowserShape>(name);
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
