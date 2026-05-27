import {
    DuplicateNodeNameError,
    InvalidNameError,
    InvalidPatternError,
    InvalidPlainObjectError,
    InvalidTopicKeyError,
} from "./errors.ts";

const NAME_SOURCE = "[A-Za-z]([A-Za-z0-9_-]{0,62}[A-Za-z0-9])?";
const NAME_REGEX = new RegExp(`^${NAME_SOURCE}$`);
const PATTERN_SEGMENT_REGEX = new RegExp(`^(\\*\\*|\\*|${NAME_SOURCE})$`);

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

export function isValidName(value: string): boolean {
    return NAME_REGEX.test(value);
}

export function assertValidName(kind: string, value: string): void {
    if (!NAME_REGEX.test(value)) {
        throw new InvalidNameError(kind, value);
    }
}

export function assertValidTopicKey(key: string): void {
    const segments = key.split(":");
    for (const segment of segments) {
        if (!NAME_REGEX.test(segment)) {
            throw new InvalidTopicKeyError(key, segment);
        }
    }
}

export function assertValidPattern(pattern: string): void {
    const segments = pattern.split(":");
    for (const segment of segments) {
        if (!PATTERN_SEGMENT_REGEX.test(segment)) {
            throw new InvalidPatternError(pattern, segment);
        }
    }
}
