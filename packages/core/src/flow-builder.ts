import { DuplicateNodeNameError } from "./errors.ts";
import type { InternalBus } from "./event-bus.ts";
import type { AnyExtension } from "./extension.ts";
import { runFlow, startFlow } from "./flow-runner.ts";
import { createNodeBuilder } from "./node-builder.ts";
import type { AnyFlow, AnyFlowDefinition, AnyRunArgs, EventMap, NodeDefinition } from "./types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function validateTopLevelNodes(nodes: readonly NodeDefinition[], flowId: string): void {
    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.name)) {
            throw new DuplicateNodeNameError(node.name, flowId);
        }
        seen.add(node.name);
    }
}

// ── Flow Factory ─────────────────────────────────────────────────────

export function createFlow(
    flowId: string,
    definition: AnyFlowDefinition,
    extensions: readonly AnyExtension[],
    bus: InternalBus<EventMap>
): AnyFlow {
    const nodeBuilder = createNodeBuilder();
    const nodes = definition.nodes(nodeBuilder);
    validateTopLevelNodes(nodes, flowId);

    const buildArgs = (args: AnyRunArgs) => ({
        bus,
        definition,
        extensions,
        flowId,
        nodes,
        params: args[0] ?? {},
    });

    return {
        id: flowId,
        run: (...args: AnyRunArgs) => runFlow(buildArgs(args)),
        start: (...args: AnyRunArgs) => startFlow(buildArgs(args)),
    };
}
