import type { TaskContext } from "./types.ts";

// ── Core context keys ──────────────────────────────────────────────

const coreContextRecord: Record<keyof TaskContext, true> = {
    attempt: true,
    emit: true,
    flow: true,
    log: true,
    params: true,
    runId: true,
    signal: true,
    state: true,
    stop: true,
    task: true,
};

export const coreContextKeys = Object.keys(coreContextRecord);

// ── Defaults ───────────────────────────────────────────────────────

export const defaultParallelMode = "fail-fast" as const;
export const defaultMergeStrategy = "strict" as const;
export const defaultRetryDelay = 0;
export const defaultRetryStrategy = "constant" as const;
