import { StopFlowError } from "../core/errors.ts";
import type { RunStatus, TerminalStatus } from "../core/types.ts";

const isTerminalStatus = (status: RunStatus): status is TerminalStatus =>
    status === "cancelled" || status === "completed" || status === "failed";

export class RunController {
    private readonly abortController = new AbortController();
    private readonly pauseWaiters: { resolve: () => void }[] = [];
    private pauseRequested = false;
    private resumeGate: { promise: Promise<void>; resolve: () => void } | undefined;
    private statusValue: RunStatus = "running";

    cancelReason: string | undefined;
    stopReason: string | undefined;

    get signal(): AbortSignal {
        return this.abortController.signal;
    }

    get isCancelled(): boolean {
        return this.cancelReason !== undefined || this.abortController.signal.aborted;
    }

    get isStopped(): boolean {
        return this.stopReason !== undefined;
    }

    cancel(reason?: string): void {
        if (isTerminalStatus(this.statusValue)) {
            return;
        }

        this.cancelReason = reason;
        this.abortController.abort(reason);
        this.resolvePauseWaiters();

        if (this.resumeGate !== undefined) {
            this.resumeGate.resolve();
        }
    }

    pause(): Promise<void> {
        if (isTerminalStatus(this.statusValue) || this.statusValue === "paused") {
            return Promise.resolve();
        }

        this.pauseRequested = true;

        const { promise, resolve } = Promise.withResolvers<void>();
        this.pauseWaiters.push({ resolve });
        return promise;
    }

    requestStop(reason?: string): never {
        if (this.stopReason === undefined) {
            this.stopReason = reason;
        }

        throw new StopFlowError(reason);
    }

    resume(): void {
        if (this.statusValue !== "paused" || this.resumeGate === undefined) {
            return;
        }

        this.pauseRequested = false;
        this.statusValue = "running";
        this.resumeGate.resolve();
        this.resumeGate = undefined;
    }

    setTerminalStatus(status: TerminalStatus): void {
        this.statusValue = status;
        this.resolvePauseWaiters();

        if (this.resumeGate !== undefined) {
            this.resumeGate.resolve();
            this.resumeGate = undefined;
        }
    }

    status(): RunStatus {
        return this.statusValue;
    }

    async waitForNextNode(): Promise<void> {
        if (!this.pauseRequested || isTerminalStatus(this.statusValue)) {
            return;
        }

        if (this.resumeGate === undefined) {
            const { promise, resolve } = Promise.withResolvers<void>();
            this.resumeGate = { promise, resolve };
            this.statusValue = "paused";
            this.resolvePauseWaiters();
        }

        await this.resumeGate.promise;
    }

    private resolvePauseWaiters(): void {
        for (const waiter of this.pauseWaiters.splice(0)) {
            waiter.resolve();
        }
    }
}
