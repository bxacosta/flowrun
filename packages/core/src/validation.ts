import { DuplicateNodeNameError, InvalidPlainObjectError } from "./errors.ts";

export function assertPlainObject(value: unknown, message: string): asserts value is object {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new InvalidPlainObjectError(message);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new InvalidPlainObjectError(message);
    }
}

export function assertUniqueNodeNames(nodes: readonly { name: string }[], parentName: string): void {
    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.name)) {
            throw new DuplicateNodeNameError(node.name, parentName);
        }
        seen.add(node.name);
    }
}
