import { type ExtensionDefinition, eventPublic, extension, requires } from "@flowrun/core";

import { createTracingLifecycle, type FlowOutcome } from "./lifecycle.ts";
import type { TracingBus, TracingEventPayloads, TracingExtensionConfig, TracingRequiredContext } from "./types.ts";

export const TRACING_EXTENSION_NAME = "tracing";

export type TracingExtensionDefinition = ExtensionDefinition<
    TracingRequiredContext,
    object,
    object,
    TracingEventPayloads
>;

export function createTracingExtension(config: TracingExtensionConfig): TracingExtensionDefinition {
    return extension({
        name: TRACING_EXTENSION_NAME,
        requires: requires<TracingRequiredContext>(),
        events: {
            "tracing:saved": eventPublic<TracingEventPayloads["tracing:saved"]>(),
        },
        provide: async ({ bus, provided, runId, flowName }) => {
            const tracingBus: TracingBus = bus;
            const lifecycle = createTracingLifecycle(provided.session.context, tracingBus, provided.storage, config, {
                runId,
                flowName,
            });

            await lifecycle.start();

            return {
                cleanup: (outcome) => lifecycle.finish(outcome.status as FlowOutcome),
            };
        },
    });
}
