import { normalizeError } from "./errors.ts";

export async function runWithConcurrency(
    tasks: readonly (() => Promise<void>)[],
    maxConcurrency: number
): Promise<void> {
    if (tasks.length === 0) {
        return;
    }

    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < tasks.length) {
            const currentIndex = nextIndex;
            nextIndex++;
            const task = tasks[currentIndex];
            if (task) {
                await task();
            }
        }
    }

    const workerCount = Math.min(maxConcurrency, tasks.length);
    await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
}

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
                    controller.abort(normalized);
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
        (branch, index) => () =>
            branch()
                .then(() => {
                    successfulIndexes.push(index);
                })
                .catch((error: unknown) => {
                    errors.push({ error: normalizeError(error), index });
                })
    );

    await runWithConcurrency(wrapped, concurrency);
    errors.sort((left, right) => left.index - right.index);
    successfulIndexes.sort((left, right) => left - right);

    return { errors, successfulIndexes };
}
