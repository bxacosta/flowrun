/**
 * core/validation.ts — Name/topic/pattern/object assertions
 *
 * Layer: L0 (core). Owns the validation errors it raises.
 */

import { FlowEngineError } from "./errors.ts";

// ── Errors ──────────────────────────────────────────────────────────

export class InvalidNameError extends FlowEngineError {
    override readonly name = "InvalidNameError";

    constructor(kind: string, value: string) {
        super(
            `Invalid ${kind} name "${value}": must start with a letter, contain only [A-Za-z0-9_-], not end with "_" or "-", and be 1-64 characters`
        );
    }
}

export class InvalidTopicKeyError extends FlowEngineError {
    override readonly name = "InvalidTopicKeyError";

    constructor(key: string, segment: string) {
        super(`Invalid topic key "${key}": segment "${segment}" does not match identifier grammar`);
    }
}

export class InvalidPatternError extends FlowEngineError {
    override readonly name = "InvalidPatternError";

    constructor(pattern: string, segment: string) {
        super(`Invalid subscribe pattern "${pattern}": segment "${segment}" must be a valid identifier, "*", or "**"`);
    }
}

export class InvalidPlainObjectError extends FlowEngineError {
    override readonly name = "InvalidPlainObjectError";
}

export class DuplicateNodeNameError extends FlowEngineError {
    override readonly name = "DuplicateNodeNameError";

    constructor(nodeName: string, parentName: string) {
        super(`Duplicate node name "${nodeName}" among siblings in "${parentName}"`);
    }
}

// ── Constants ───────────────────────────────────────────────────────

const NAME_SOURCE = "[A-Za-z]([A-Za-z0-9_-]{0,62}[A-Za-z0-9])?";
const NAME_REGEX = new RegExp(`^${NAME_SOURCE}$`);
const PATTERN_SEGMENT_REGEX = new RegExp(`^(\\*\\*|\\*|${NAME_SOURCE})$`);

// ── Assertions ──────────────────────────────────────────────────────

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
