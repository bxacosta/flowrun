import type { Shape } from "@flowrun/core";

import type { SelectorRegistry } from "../../contracts/selectors.ts";

export interface SelectorsExtensionConfig<TName extends string = string> {
    registry: SelectorRegistry<TName>;
}

export interface SelectorsProvidedContext<TName extends string = string> {
    selectors: SelectorRegistry<TName>;
}

export interface SelectorsShape<TName extends string = string> extends Shape {
    provided: SelectorsProvidedContext<TName>;
}
