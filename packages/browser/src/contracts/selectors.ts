import type { MaybePromise } from "@flowrun/core";
import type { Frame, Locator, Page } from "playwright-core";

export type LocatorScope = Frame | Locator | Page;

export interface SelectorDefinition {
    description?: string;
    selector: string;
    timeout?: number;
}

export interface SelectorRegistry<TName extends string = string> {
    get(name: TName): MaybePromise<SelectorDefinition>;
    resolve(name: TName, scope: LocatorScope): MaybePromise<Locator>;
}
