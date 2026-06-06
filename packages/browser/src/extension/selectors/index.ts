import { type ExtensionDefinition, extension } from "@flowrun/core";

import type { SelectorsExtensionConfig, SelectorsProvidedContext } from "./types.ts";

export const SELECTORS_EXTENSION_NAME = "selectors";

export type SelectorsExtensionDefinition<TName extends string = string> = ExtensionDefinition<
    object,
    SelectorsProvidedContext<TName>
>;

export function createSelectorsExtension<TName extends string = string>(
    config: SelectorsExtensionConfig<TName>
): SelectorsExtensionDefinition<TName> {
    return extension({
        name: SELECTORS_EXTENSION_NAME,
        setup: () => ({
            provided: { selectors: config.registry },
        }),
    });
}
