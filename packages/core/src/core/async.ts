/**
 * core/async.ts — Async/cancellation primitives
 *
 * Layer: L0 (core). Pause gating, child abort controllers, signal-aware sleep,
 * and bounded-concurrency branch execution.
 */

import { normalizeError } from "./errors.ts";

// ── Pause gate ──────────────────────────────────────────────────────

export class PauseGate {
    #paused = false;
    readonly #waiters: (() => void)[] = [];

    pause(): void {
        this.#paused = true;
    }

    resume(): void {
        if (!this.#paused) {
            return;
        }
        this.#paused = false;
        const waiters = this.#waiters.splice(0);
        for (const resolve of waiters) {
            resolve();
        }
    }

    async waitIfPaused(): Promise<void> {
        if (!this.#paused) {
            return;
        }
        await new Promise<void>((resolve) => {
            this.#waiters.push(resolve);
        });
    }
}

// ── Abort/sleep helpers ─────────────────────────────────────────────

export function createChildController(parent: AbortSignal): { cleanup: () => void; controller: AbortController } {
    const controller = new AbortController();

    if (parent.aborted) {
        controller.abort(parent.reason);
        return { cleanup: () => undefined, controller };
    }

    const abort = () => controller.abort(parent.reason);
    parent.addEventListener("abort", abort, { once: true });

    return {
        cleanup: () => parent.removeEventListener("abort", abort),
        controller,
    };
}

export async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };

        signal.addEventListener("abort", onAbort, { once: true });
    });
}

// ── Bounded-concurrency branch execution ────────────────────────────

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
