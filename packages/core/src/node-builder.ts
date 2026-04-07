import type { AnyScope, EveryConfig, IterationScope, Node, NodeBuilder, NodesSpec } from "./types.ts";
import { assertUniqueNodeNames } from "./validation.ts";

// ── Nodes Resolver ───────────────────────────────────────────────────

export function resolveNodes<TScope extends AnyScope>(
    spec: NodesSpec<TScope>,
    builder: NodeBuilder<TScope>
): Node<TScope>[] {
    const nodes = typeof spec === "function" ? spec(builder) : spec;
    return [...nodes];
}

// ── Node Builder Factory ─────────────────────────────────────────────

export function createNodeBuilder<TScope extends AnyScope>(): NodeBuilder<TScope> {
    return {
        every<TItem>(config: EveryConfig<TScope, TItem>) {
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
        },

        parallel(config) {
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
        },

        task(config) {
            return {
                handler: config.handler,
                middleware: config.middleware ?? [],
                name: config.name,
                onError: config.onError ?? "fail",
                retry: config.retry,
                type: "task",
            };
        },
    };
}
