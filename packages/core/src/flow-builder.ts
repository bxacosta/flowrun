import type { InternalBus } from "./event-bus.ts";
import type { EventMap } from "./events.ts";
import type { AnyExtension } from "./extension.ts";
import { runFlow, startFlow } from "./flow-runner.ts";
import { createNodeBuilder, resolveNodes } from "./node-builder.ts";
import type { AnyFlow, AnyRunArgs, AnyScope, FlowConfig } from "./types.ts";
import { assertUniqueNodeNames } from "./validation.ts";

// ── Flow Factory ─────────────────────────────────────────────────────

export function createFlow<TScope extends AnyScope>(
    config: FlowConfig<TScope>,
    extensions: readonly AnyExtension[],
    bus: InternalBus<EventMap>
): AnyFlow {
    const nodes = resolveNodes(config.nodes, createNodeBuilder<TScope>());
    assertUniqueNodeNames(nodes, config.name);

    const buildArgs = (args: AnyRunArgs) => ({
        bus,
        config,
        extensions,
        nodes,
        params: args[0] ?? {},
    });

    return {
        name: config.name,
        run: (...args: AnyRunArgs) => runFlow(buildArgs(args)),
        start: (...args: AnyRunArgs) => startFlow(buildArgs(args)),
    };
}
