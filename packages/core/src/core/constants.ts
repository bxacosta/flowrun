export const coreContextKeys = [
    "attempt",
    "emit",
    "flow",
    "log",
    "params",
    "runId",
    "signal",
    "state",
    "stop",
    "task",
] as const;

export const defaultParallelMode = "fail-fast" as const;
export const defaultMergeStrategy = "strict" as const;
export const defaultRetryDelay = 0;
export const defaultRetryStrategy = "constant" as const;
