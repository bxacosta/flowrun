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
