import { createEngine as createCoreEngine, type Engine, type EngineConfig } from "@flowrun/core";

import { createBrowserExtension } from "../extension/browser/index.ts";
import type { BrowserExtensionConfig, BrowserProvidedContext } from "../extension/browser/types.ts";

export type BrowserEngine = Engine<BrowserProvidedContext>;

export type CreateBrowserEngineConfig = BrowserExtensionConfig & { engine?: EngineConfig };

export function createBrowserEngine(config: CreateBrowserEngineConfig): BrowserEngine {
    const { engine: engineConfig, ...browserConfig } = config;
    return createCoreEngine(engineConfig).use(createBrowserExtension(browserConfig));
}
