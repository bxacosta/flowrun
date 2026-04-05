import { DuplicateNodeNameError } from "./errors.ts";
import type { AnyScope, ChildrenSpec, EachScope, EveryConfig, Node, NodeBuilder, NodeDefinition } from "./types.ts";

// ── Validation ───────────────────────────────────────────────────────

function validateSiblingNames(children: readonly NodeDefinition[], containerName: string): void {
    const seen = new Set<string>();
    for (const child of children) {
        if (seen.has(child.name)) {
            throw new DuplicateNodeNameError(child.name, containerName);
        }
        seen.add(child.name);
    }
}

// ── Children Resolver ────────────────────────────────────────────────

export function resolveChildren<TScope extends AnyScope>(
    spec: ChildrenSpec<TScope>,
    builder: NodeBuilder<TScope>
): Node<TScope>[] {
    const nodes = typeof spec === "function" ? spec(builder) : spec;
    return [...nodes];
}

// ── Node Builder Factory ─────────────────────────────────────────────

export function createNodeBuilder<TScope extends AnyScope>(): NodeBuilder<TScope> {
    return {
        every<TItem>(config: EveryConfig<TScope, TItem>) {
            const childNodes = resolveChildren(config.children, createNodeBuilder<EachScope<TScope, TItem>>());
            validateSiblingNames(childNodes, config.name);
            return {
                children: childNodes,
                cleanupProvided: config.cleanupProvided,
                concurrency: config.concurrency ?? Number.POSITIVE_INFINITY,
                forkProvided: config.forkProvided,
                items: config.items,
                merge: config.merge ?? "overwrite",
                name: config.name,
                onError: config.onError ?? "fail-fast",
                type: "every",
            };
        },

        parallel(config) {
            const childNodes = resolveChildren(config.children, createNodeBuilder<TScope>());
            validateSiblingNames(childNodes, config.name);
            return {
                children: childNodes,
                cleanupProvided: config.cleanupProvided,
                forkProvided: config.forkProvided,
                merge: config.merge ?? "overwrite",
                name: config.name,
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
