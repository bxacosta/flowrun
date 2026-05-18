import { readFile } from "node:fs/promises";
import type { Locator } from "playwright-core";

import type { LocatorScope, SelectorDefinition, SelectorRegistry } from "../contracts/selectors.ts";
import { SelectorNotFoundError } from "../errors.ts";

export class JsonSelectorRegistry implements SelectorRegistry {
    private definitions: Map<string, SelectorDefinition>;
    private readonly source: string | null;

    private constructor(definitions: Map<string, SelectorDefinition>, source: string | null) {
        this.definitions = definitions;
        this.source = source;
    }

    static async load(filePath: string): Promise<JsonSelectorRegistry> {
        return new JsonSelectorRegistry(await JsonSelectorRegistry.loadMap(filePath), filePath);
    }

    static fromObject(definitions: Record<string, SelectorDefinition>): JsonSelectorRegistry {
        return new JsonSelectorRegistry(JsonSelectorRegistry.buildMap(definitions), null);
    }

    get(name: string): SelectorDefinition {
        const definition = this.definitions.get(name);
        if (!definition) {
            throw new SelectorNotFoundError(name);
        }
        return definition;
    }

    resolve(name: string, scope: LocatorScope): Locator {
        return scope.locator(this.get(name).selector);
    }

    async reload(): Promise<void> {
        if (!this.source) {
            return;
        }
        this.definitions = await JsonSelectorRegistry.loadMap(this.source);
    }

    private static async loadMap(filePath: string): Promise<Map<string, SelectorDefinition>> {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, SelectorDefinition>;
        return JsonSelectorRegistry.buildMap(parsed);
    }

    private static buildMap(definitions: Record<string, SelectorDefinition>): Map<string, SelectorDefinition> {
        const map = new Map<string, SelectorDefinition>();
        for (const [name, value] of Object.entries(definitions)) {
            map.set(name, Object.freeze({ ...value }));
        }
        return map;
    }
}
