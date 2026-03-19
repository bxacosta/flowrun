export const createLinkedAbortController = (parent: AbortSignal): AbortController => {
    const controller = new AbortController();

    const abort = () => {
        controller.abort(parent.reason);
    };

    if (parent.aborted) {
        abort();
        return controller;
    }

    parent.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener(
        "abort",
        () => {
            parent.removeEventListener("abort", abort);
        },
        { once: true }
    );

    return controller;
};

export const createCompositeAbortController = (signals: readonly AbortSignal[]): AbortController => {
    const controller = new AbortController();

    const abort = (signal: AbortSignal) => {
        controller.abort(signal.reason);
    };

    for (const signal of signals) {
        if (signal.aborted) {
            abort(signal);
            return controller;
        }
    }

    const listeners = signals.map((signal) => {
        const listener = () => {
            abort(signal);
        };

        signal.addEventListener("abort", listener, { once: true });
        return { listener, signal };
    });

    controller.signal.addEventListener(
        "abort",
        () => {
            for (const entry of listeners) {
                entry.signal.removeEventListener("abort", entry.listener);
            }
        },
        { once: true }
    );

    return controller;
};
