import {
    createEngine as createCoreEngine,
    type Engine,
    type EngineConfig,
    type SystemEvents,
    type SystemPublicEvents,
} from "@flowrun/core";

import { createBrowserExtension } from "../extension/browser-extension.ts";
import type { BrowserEventPayloads, BrowserExtensionConfig, BrowserProvidedContext } from "../extension/types.ts";

export type BrowserEngine = Engine<
    BrowserProvidedContext,
    SystemPublicEvents & BrowserEventPayloads,
    SystemEvents & BrowserEventPayloads
>;

export type CreateBrowserEngineConfig = BrowserExtensionConfig & { engine?: EngineConfig };

export function createBrowserEngine(config: CreateBrowserEngineConfig): BrowserEngine {
    const { engine: engineConfig, ...browserConfig } = config;
    return createCoreEngine(engineConfig).use(createBrowserExtension(browserConfig));
}
