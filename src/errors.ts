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