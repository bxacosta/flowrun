import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "playwright-core";

import type { StorageProvider } from "../../contracts/storage.ts";
import { type TraceReason, type TracingEmit, type TracingExtensionConfig, tracingEvents } from "./types.ts";

export type FlowOutcome = "cancelled" | "failed" | "success";

export interface TracingMeta {
    flowName: string;
    runId: string;
}

interface TracingState {
    started: boolean;
    tempZipPath: string;
}

export interface TracingLifecycle {
    finish(outcome: FlowOutcome): Promise<void>;
    start(): Promise<void>;
}

const NOOP_LIFECYCLE: TracingLifecycle = {
    start: () => Promise.resolve(),
    finish: () => Promise.resolve(),
};

export function createTracingLifecycle(
    context: BrowserContext,
    emit: TracingEmit,
    storage: StorageProvider,
    config: TracingExtensionConfig,
    meta: TracingMeta
): TracingLifecycle {
    if (config.mode === "off") {
        return NOOP_LIFECYCLE;
    }

    const state: TracingState = {
        started: false,
        tempZipPath: join(tmpdir(), `flowrun-trace-${meta.runId}.zip`),
    };

    const storageKey = config.storageKey
        ? config.storageKey({ runId: meta.runId, flowName: meta.flowName })
        : `traces/${meta.flowName}/${meta.runId}.zip`;

    return {
        async start() {
            await context.tracing.start({
                screenshots: config.screenshots ?? true,
                snapshots: config.snapshots ?? true,
                sources: config.sources ?? false,
            });
            state.started = true;
        },

        async finish(outcome) {
            if (!state.started) {
                return;
            }

            const failed = outcome !== "success";
            const reason = decideReason(config.mode, failed);

            if (reason === null) {
                await context.tracing.stop().catch(() => undefined);
                return;
            }

            try {
                await context.tracing.stop({ path: state.tempZipPath });
                const buffer = await readFile(state.tempZipPath);
                const result = await storage.save(storageKey, buffer);
                emit(tracingEvents.saved, { key: result.key, reason, size: result.size });
            } finally {
                await rm(state.tempZipPath, { force: true }).catch(() => undefined);
            }
        },
    };
}

function decideReason(mode: TracingExtensionConfig["mode"], failed: boolean): TraceReason | null {
    if (mode === "on") {
        return "always";
    }
    if (failed) {
        return mode === "retain-on-failure" ? "retained" : "on-failure";
    }
    return null;
}
