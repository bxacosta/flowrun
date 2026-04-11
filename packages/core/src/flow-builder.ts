import type { InternalBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";
import type { AnyExtension } from "./extension.ts";
import { runFlow, startFlow } from "./flow-runner.ts";
import { createNodeBuilder, resolveNodes } from "./node-builder.ts";
import type { AnyFlow, AnyRunArgs, AnyScope, FlowDefinition } from "./types.ts";
import { assertUniqueNodeNames } from "./validation.ts";

// ── Flow Factory ─────────────────────────────────────────────────────

export function createFlow<TScope extends AnyScope>(
    flowName: string,
    definition: FlowDefinition<TScope>,
    extensions: readonly AnyExtension[],
    bus: InternalBus<EventMap>
): AnyFlow {
    const nodes = resolveNodes(definition.nodes, createNodeBuilder<TScope>());
    assertUniqueNodeNames(nodes, flowName);

    const buildArgs = (args: AnyRunArgs) => ({
        bus,
        definition,
        extensions,
        flowName,
        nodes,
        params: args[0] ?? {},
    });

    return {
        name: flowName,
        run: (...args: AnyRunArgs) => runFlow(buildArgs(args)),
        start: (...args: AnyRunArgs) => startFlow(buildArgs(args)),
    };
}
