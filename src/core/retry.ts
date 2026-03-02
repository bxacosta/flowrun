import { StepTimeoutError } from "./errors.ts";
import type { RetryPolicy } from "./types.ts";

export function computeRetryDelay(policy: RetryPolicy, attemptIndex: number): number {
    const baseDelay = policy.delayMs ?? 0;
    const strategy = policy.strategy ?? "constant";
    const rawDelay = strategy === "exponential" ? baseDelay * 2 ** attemptIndex : baseDelay;

    if (policy.maxDelayMs === undefined) {
        return rawDelay;
    }

    return Math.min(rawDelay, policy.maxDelayMs);
}

export async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);

        if (!signal) {
            return;
        }

        if (signal.aborted) {
            clearTimeout(timer);
            reject(signal.reason);
            return;
        }

        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(signal.reason);
            },
            { once: true }
        );
    });
}

export function createLinkedAbortController(parentSignal?: AbortSignal): AbortController {
    const controller = new AbortController();

    if (!parentSignal) {
        return controller;
    }

    if (parentSignal.aborted) {
        controller.abort(parentSignal.reason);
        return controller;
    }

    parentSignal.addEventListener("abort", () => controller.abort(parentSignal.reason), { once: true });

    return controller;
}

export async function runWithTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    stepName: string,
    onTimeout: () => void
): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onTimeout();
            reject(new StepTimeoutError(stepName, timeoutMs));
        }, timeoutMs);

        operation.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}
