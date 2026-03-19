export const waitForDelay = (delayMs: number, signal: AbortSignal): Promise<void> => {
    if (delayMs <= 0 || signal.aborted) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, delayMs);

        const onAbort = () => {
            clearTimeout(timeout);
            resolve();
        };

        signal.addEventListener("abort", onAbort, { once: true });
    });
};
