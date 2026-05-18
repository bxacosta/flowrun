import { FlowEngineError } from "@flowrun/core";

export class BrowserError extends FlowEngineError {
    override readonly name: string = "BrowserError";
}

export class SelectorNotFoundError extends BrowserError {
    override readonly name = "SelectorNotFoundError";
    readonly selectorName: string;

    constructor(selectorName: string) {
        super(`Selector "${selectorName}" is not registered`);
        this.selectorName = selectorName;
    }
}

export class NavigationError extends BrowserError {
    override readonly name = "NavigationError";
    readonly url: string;
    readonly durationMs: number;

    constructor(url: string, durationMs: number, cause?: unknown) {
        super(`Navigation to "${url}" failed after ${durationMs}ms`, { cause });
        this.url = url;
        this.durationMs = durationMs;
    }
}

export type BrowserSessionPhase = "close" | "open";

export class BrowserSessionError extends BrowserError {
    override readonly name = "BrowserSessionError";
    readonly phase: BrowserSessionPhase;

    constructor(phase: BrowserSessionPhase, cause?: unknown) {
        super(`Browser session ${phase} failed`, { cause });
        this.phase = phase;
    }
}

export class BrowserProviderDisposedError extends BrowserError {
    override readonly name = "BrowserProviderDisposedError";

    constructor() {
        super("Browser provider has been disposed and can no longer open sessions");
    }
}

export type StorageOperation = "delete" | "exists" | "head" | "list" | "read" | "readStream" | "save" | "saveStream";

export class StorageError extends BrowserError {
    override readonly name = "StorageError";
    readonly key: string;
    readonly operation: StorageOperation;

    constructor(operation: StorageOperation, key: string, message?: string, cause?: unknown) {
        super(message ?? `Storage ${operation} failed for key "${key}"`, { cause });
        this.key = key;
        this.operation = operation;
    }
}
