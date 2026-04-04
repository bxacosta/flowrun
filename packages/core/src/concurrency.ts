import { normalizeError } from "./errors.ts";

// ── Concurrency Helper ───────────────────────────────────────────────

export async function runWithConcurrency(
    tasks: readonly (() => Promise<void>)[],
    maxConcurrency: number
): Promise<void> {
    if (tasks.length === 0) {
        return;
    }

    let taskIndex = 0;

    async function worker(): Promise<void> {
        while (taskIndex < tasks.length) {
            const currentIndex = taskIndex;
            taskIndex++;
            const task = tasks[currentIndex];
            if (task) {
                await task();
            }
        }
    }

    const workerCount = Math.min(maxConcurrency, tasks.length);
    const workers: Promise<void>[] = [];
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
        workers.push(worker());
    }

    await Promise.allSettled(workers);
}

// ── Branch Execution Helpers ─────────────────────────────────────────

export async function executeFailFastBranches(
    branches: readonly (() => Promise<void>)[],
    controller: AbortController,
    concurrency: number
): Promise<Error | null> {
    let firstError: Error | null = null;

    const wrapped = branches.map(
        (branch) => () =>
            branch().catch((error: unknown) => {
                const normalized = normalizeError(error);
                if (!firstError) {
                    firstError = normalized;
                    controller.abort();
                }
                throw normalized;
            })
    );

    await runWithConcurrency(wrapped, concurrency);
    return firstError;
}

export async function executeContinueBranches(
    branches: readonly (() => Promise<void>)[],
    concurrency: number
): Promise<{ errors: { error: Error; index: number }[]; successfulIndexes: number[] }> {
    const errors: { error: Error; index: number }[] = [];
    const successfulIndexes: number[] = [];

    const wrapped = branches.map(
        (branch, branchIndex) => () =>
            branch()
                .then(() => {
                    successfulIndexes.push(branchIndex);
                })
                .catch((error: unknown) => {
                    errors.push({ error: normalizeError(error), index: branchIndex });
                })
    );

    await runWithConcurrency(wrapped, concurrency);
    successfulIndexes.sort((a, b) => a - b);
    errors.sort((a, b) => a.index - b.index);
    return { errors, successfulIndexes };
}
