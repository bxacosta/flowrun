import { DuplicateNodeNameError } from "./errors.ts";
import { createNodeBuilder, resolveNodes } from "./node-builder.ts";
import type {
    AnyScope,
    EachScope,
    EveryConfig,
    FlowDefinition,
    Node,
    NodeDefinition,
    ParallelConfig,
    TaskConfig,
} from "./types.ts";

// ── Validation ───────────────────────────────────────────────────────

function validateSiblingNames(nodes: readonly NodeDefinition[], containerName: string): void {
    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.name)) {
            throw new DuplicateNodeNameError(node.name, containerName);
        }
        seen.add(node.name);
    }
}

// ── defineTask ───────────────────────────────────────────────────────

export function defineTask<TScope extends AnyScope>(config: TaskConfig<TScope>): Node<TScope> {
    return {
        handler: config.handler,
        middleware: config.middleware ?? [],
        name: config.name,
        onError: config.onError ?? "fail",
        retry: config.retry,
        type: "task",
    };
}

// ── defineParallel ───────────────────────────────────────────────────

export function defineParallel<TScope extends AnyScope>(config: ParallelConfig<TScope>): Node<TScope> {
    const childNodes = resolveNodes(config.nodes, createNodeBuilder<TScope>());
    validateSiblingNames(childNodes, config.name);
    return {
        cleanupProvided: config.cleanupProvided,
        forkProvided: config.forkProvided,
        merge: config.merge ?? "overwrite",
        name: config.name,
        nodes: childNodes,
        onError: config.onError ?? "fail-fast",
        type: "parallel",
    };
}

// ── defineEvery ──────────────────────────────────────────────────────

export function defineEvery<TScope extends AnyScope, TItem>(config: EveryConfig<TScope, TItem>): Node<TScope> {
    const childNodes = resolveNodes(config.nodes, createNodeBuilder<EachScope<TScope, TItem>>());
    validateSiblingNames(childNodes, config.name);
    return {
        cleanupProvided: config.cleanupProvided,
        concurrency: config.concurrency ?? Number.POSITIVE_INFINITY,
        forkProvided: config.forkProvided,
        items: config.items,
        merge: config.merge ?? "overwrite",
        name: config.name,
        nodes: childNodes,
        onError: config.onError ?? "fail-fast",
        type: "every",
    };
}

// ── defineFlow ───────────────────────────────────────────────────────

export function defineFlow<TScope extends AnyScope>(definition: FlowDefinition<TScope>): FlowDefinition<TScope> {
    return definition;
}
