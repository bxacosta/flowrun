import type { MaybePromise } from "@flowrun/core";
import type { Frame, Locator, Page } from "playwright-core";

export type LocatorScope = Frame | Locator | Page;

export interface SelectorDefinition {
    description?: string;
    selector: string;
    timeout?: number;
}

export interface SelectorRegistry {
    get(name: string): MaybePromise<SelectorDefinition>;
    resolve(name: string, scope: LocatorScope): MaybePromise<Locator>;
}
