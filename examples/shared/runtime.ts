export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);

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
                reject(new Error("Operation aborted"));
            },
            {once: true},
        );
    });
}
