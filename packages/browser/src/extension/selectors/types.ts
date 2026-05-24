import type { Shape, WithProvided } from "@flowrun/core";

import type { SelectorRegistry } from "../../contracts/selectors.ts";

export interface SelectorsExtensionConfig {
    registry: SelectorRegistry;
}

export interface SelectorsProvidedContext {
    selectors: SelectorRegistry;
}

export interface SelectorsShape extends Shape {
    provided: SelectorsProvidedContext;
}

export type WithSelectors<TShape extends Shape = Shape> = WithProvided<TShape, SelectorsProvidedContext>;
