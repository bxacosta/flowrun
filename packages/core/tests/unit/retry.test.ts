import { describe, expect, test } from "bun:test";
import { StepTimeoutError } from "../../src/index.ts";
import { computeRetryDelay, createLinkedAbortController, runWithTimeout, wait } from "../../src/core/retry.ts";

describe("retry helpers", () => {
    test("computes constant and exponential delays", () => {
        expect(computeRetryDelay({ attempts: 3, delayMs: 25 }, 2)).toBe(25);
        expect(computeRetryDelay({ attempts: 3, delayMs: 25, strategy: "exponential" }, 2)).toBe(100);
        expect(computeRetryDelay({ attempts: 3, delayMs: 25, strategy: "exponential", maxDelayMs: 60 }, 2)).toBe(60);
    });

    test("wait resolves immediately for zero delay", () => {
        expect(wait(0)).resolves.toBeUndefined();
    });

    test("wait rejects when signal aborts", () => {
        const controller = new AbortController();
        const promise = wait(100, controller.signal);
        controller.abort("cancelled");

        expect(promise).rejects.toBe("cancelled");
    });

    test("linked abort controller mirrors parent signal", () => {
        const parent = new AbortController();
        const linked = createLinkedAbortController(parent.signal);

        parent.abort("boom");

        expect(linked.signal.aborted).toBe(true);
        expect(linked.signal.reason).toBe("boom");
    });

    test("runWithTimeout rejects with StepTimeoutError and calls timeout hook", () => {
        let timedOut = false;
        const { promise: pending } = Promise.withResolvers<never>();

        expect(
            runWithTimeout(pending, 10, "slow-step", () => {
                timedOut = true;
            })
        ).rejects.toThrow(StepTimeoutError);

        expect(timedOut).toBe(true);
    });

    test("runWithTimeout returns the underlying value when it finishes on time", () => {
        expect(
            runWithTimeout(Promise.resolve("ok"), 50, "fast-step", () => {
                // empty step
            })
        ).resolves.toBe("ok");
    });
});
