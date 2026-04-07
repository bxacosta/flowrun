import { createNodeBuilder, resolveNodes } from "./node-builder.ts";
import type {
    AnyScope,
    EveryConfig,
    FlowDefinition,
    IterationScope,
    Node,
    ParallelConfig,
    TaskConfig,
} from "./types.ts";
import { assertUniqueNodeNames } from "./validation.ts";

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
    assertUniqueNodeNames(childNodes, config.name);
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
    const childNodes = resolveNodes(config.nodes, createNodeBuilder<IterationScope<TScope, TItem>>());
    assertUniqueNodeNames(childNodes, config.name);
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
