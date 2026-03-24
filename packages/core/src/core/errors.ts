export class FlowEngineError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FlowEngineError";
    }
}

export class TaskTimeoutError extends FlowEngineError {
    readonly taskId: string;
    readonly timeoutMs: number;

    constructor(taskId: string, timeoutMs: number) {
        super(`Task "${taskId}" timed out after ${timeoutMs}ms`);
        this.name = "TaskTimeoutError";
        this.taskId = taskId;
        this.timeoutMs = timeoutMs;
    }
}

export class ParallelMergeError extends FlowEngineError {
    readonly stateKey: string;

    constructor(stateKey: string, message?: string) {
        super(message ?? `Parallel branches wrote conflicting values for key "${stateKey}"`);
        this.name = "ParallelMergeError";
        this.stateKey = stateKey;
    }
}

export class StopFlowError extends Error {
    readonly reason: string | undefined;

    constructor(reason?: string) {
        super(reason ?? "Flow stopped");
        this.name = "StopFlowError";
        this.reason = reason;
    }
}
