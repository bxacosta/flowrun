import { type ExtensionDefinition, extension } from "@flowrun/core";

import type { SelectorsExtensionConfig, SelectorsProvidedContext } from "./types.ts";

export const SELECTORS_EXTENSION_NAME = "selectors";

export type SelectorsExtensionDefinition = ExtensionDefinition<object, SelectorsProvidedContext>;

export function createSelectorsExtension(config: SelectorsExtensionConfig): SelectorsExtensionDefinition {
    return extension({
        name: SELECTORS_EXTENSION_NAME,
        provide: () => ({
            provided: { selectors: config.registry },
        }),
    });
}
