import type { Shape } from "@flowrun/core";

import type { BrowserEventPayloads, BrowserProvidedContext } from "../extension/browser/types.ts";
import { newPage } from "../resources/new-page.ts";
import { newSession } from "../resources/new-session.ts";

export type { NewPageOptions } from "../resources/new-page.ts";
export type { NewSessionOptions } from "../resources/new-session.ts";

export interface BrowserShape extends Shape {
    events: BrowserEventPayloads;
    provided: BrowserProvidedContext;
}

export const resource = {
    newPage,
    newSession,
} as const;
