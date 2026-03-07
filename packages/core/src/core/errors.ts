export class FlowEngineError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "FlowEngineError";
    }
}

export class StepTimeoutError extends FlowEngineError {
    constructor(stepName: string, timeoutMs: number) {
        super(`Step "${stepName}" timed out after ${timeoutMs}ms`);
        this.name = "StepTimeoutError";
    }
}

export class ParallelMergeError extends FlowEngineError {
    readonly keys: string[];

    constructor(keys: string[]) {
        super(`Parallel branches wrote conflicting state keys: ${keys.join(", ")}`);
        this.name = "ParallelMergeError";
        this.keys = keys;
    }
}

export class FlowStopSignal extends Error {
    readonly reason?: string;

    constructor(reason?: string) {
        super(reason ?? "Flow stopped");
        this.name = "FlowStopSignal";
        this.reason = reason;
    }
}
