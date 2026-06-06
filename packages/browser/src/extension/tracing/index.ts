import { type ExtensionDefinition, extension, requires } from "@flowrun/core";

import { createTracingLifecycle, type FlowOutcome } from "./lifecycle.ts";
import { type TracingExtensionConfig, type TracingRequiredContext, tracingEvents } from "./types.ts";

export const TRACING_EXTENSION_NAME = "tracing";

export type TracingExtensionDefinition = ExtensionDefinition<TracingRequiredContext>;

export function createTracingExtension(config: TracingExtensionConfig): TracingExtensionDefinition {
    return extension({
        name: TRACING_EXTENSION_NAME,
        requires: requires<TracingRequiredContext>(),
        events: [tracingEvents.saved],
        setup: async ({ emit, flowName, provided, runId }) => {
            const lifecycle = createTracingLifecycle(provided.session.context, emit, provided.storage, config, {
                flowName,
                runId,
            });

            await lifecycle.start();

            return {
                dispose: (outcome) => lifecycle.finish(outcome.status as FlowOutcome),
            };
        },
    });
}
