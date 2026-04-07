import { DuplicateNodeNameError, FlowEngineError } from "./errors.ts";
import type { NodeDefinition } from "./types.ts";

export function assertPlainObject(value: unknown, errorMessage: string): asserts value is object {
    if (Array.isArray(value) || typeof value === "function") {
        throw new FlowEngineError(errorMessage);
    }
}

export function assertUniqueNodeNames(nodes: readonly NodeDefinition[], containerName: string): void {
    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.name)) {
            throw new DuplicateNodeNameError(node.name, containerName);
        }
        seen.add(node.name);
    }
}
