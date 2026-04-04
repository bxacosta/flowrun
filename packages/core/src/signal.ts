// ── Pause Gate ──────────────────────────────────────────────────────

export class PauseGate {
    private paused = false;
    private gate: Promise<void> | null = null;
    private resolveGate: (() => void) | null = null;

    pause(): void {
        if (!this.paused) {
            this.paused = true;
            this.gate = new Promise((resolve) => {
                this.resolveGate = resolve;
            });
        }
    }

    resume(): void {
        if (this.paused) {
            this.paused = false;
            this.resolveGate?.();
            this.gate = null;
            this.resolveGate = null;
        }
    }

    async waitIfPaused(): Promise<void> {
        if (this.gate) {
            await this.gate;
        }
    }

    get isPaused(): boolean {
        return this.paused;
    }
}

// ── AbortSignal Helpers ──────────────────────────────────────────────

export function createChildController(parentSignal: AbortSignal): {
    cleanup: () => void;
    controller: AbortController;
} {
    const controller = new AbortController();

    if (parentSignal.aborted) {
        controller.abort(parentSignal.reason);
        return {
            cleanup: () => {
                /* no listener to remove */
            },
            controller,
        };
    }

    const propagate = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", propagate, { once: true });

    return {
        cleanup: () => parentSignal.removeEventListener("abort", propagate),
        controller,
    };
}

export function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
        return Promise.resolve();
    }
    if (signal.aborted) {
        return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
