import type { TerminalRequestStatus } from "./request.ts";

export class FlowEngineError extends Error {
    override readonly name: string = "FlowEngineError";
}

export class DuplicateFlowError extends FlowEngineError {
    override readonly name = "DuplicateFlowError";

    constructor(flowName: string) {
        super(`Flow "${flowName}" is already registered`);
    }
}

export class DuplicateExtensionError extends FlowEngineError {
    override readonly name = "DuplicateExtensionError";

    constructor(extensionName: string) {
        super(`Extension "${extensionName}" is already registered`);
    }
}

export class DuplicateNodeNameError extends FlowEngineError {
    override readonly name = "DuplicateNodeNameError";

    constructor(nodeName: string, parentName: string) {
        super(`Duplicate node name "${nodeName}" among siblings in "${parentName}"`);
    }
}

export class FlowNotRegisteredError extends FlowEngineError {
    override readonly name = "FlowNotRegisteredError";

    constructor(flowName: string) {
        super(`Flow "${flowName}" is not registered`);
    }
}

export class InvalidItemsError extends FlowEngineError {
    override readonly name = "InvalidItemsError";

    constructor(nodeName: string) {
        super(`Node "${nodeName}": items must return an array`);
    }
}

export class InvalidPlainObjectError extends FlowEngineError {
    override readonly name = "InvalidPlainObjectError";
}

export class InvalidNameError extends FlowEngineError {
    override readonly name = "InvalidNameError";

    constructor(kind: string, value: string) {
        super(
            `Invalid ${kind} name "${value}": must start with a letter, contain only [A-Za-z0-9_-], not end with "_" or "-", and be 1-64 characters`
        );
    }
}

export class InvalidTopicKeyError extends FlowEngineError {
    override readonly name = "InvalidTopicKeyError";

    constructor(key: string, segment: string) {
        super(`Invalid topic key "${key}": segment "${segment}" does not match identifier grammar`);
    }
}

export class InvalidPatternError extends FlowEngineError {
    override readonly name = "InvalidPatternError";

    constructor(pattern: string, segment: string) {
        super(`Invalid subscribe pattern "${pattern}": segment "${segment}" must be a valid identifier, "*", or "**"`);
    }
}

export class InvalidMergeValueError extends FlowEngineError {
    override readonly name = "InvalidMergeValueError";
    readonly forkLabel: number | string;
    readonly key: string;

    constructor(key: string, forkLabel: number | string) {
        super(
            `Merge strategy "append" requires array values, but fork "${forkLabel}" wrote non-array for key "${key}"`
        );
        this.key = key;
        this.forkLabel = forkLabel;
    }
}

export class MergeConflictError extends FlowEngineError {
    override readonly name = "MergeConflictError";
    readonly conflictingKey: string;
    readonly forkLabels: readonly (number | string)[];

    constructor(key: string, forkLabels: readonly (number | string)[]) {
        super(`Merge conflict on key "${key}": written by forks [${forkLabels.join(", ")}]`);
        this.conflictingKey = key;
        this.forkLabels = forkLabels;
    }
}

export class SkipSignal extends Error {
    override readonly name = "SkipSignal";
    readonly reason: string | undefined;

    constructor(reason?: string) {
        super(reason ?? "Task skipped");
        this.reason = reason;
    }
}

export class FlowCancellationSignal extends Error {
    override readonly name = "FlowCancellationSignal";
    readonly reason: string | undefined;

    constructor(reason?: string) {
        super(reason ?? "Flow cancelled");
        this.reason = reason;
    }
}

export class RequestError extends FlowEngineError {
    override readonly name: string = "RequestError";
    readonly requestId: string | undefined;
    readonly requestName: string | undefined;

    constructor(message: string, options?: { requestId?: string; requestName?: string }) {
        super(message);
        this.requestId = options?.requestId;
        this.requestName = options?.requestName;
    }
}

export class RequestTimeoutError extends RequestError {
    override readonly name = "RequestTimeoutError";
    readonly timeoutMs: number;

    constructor(requestName: string, requestId: string, timeoutMs: number) {
        super(`Request "${requestName}" timed out after ${timeoutMs}ms`, { requestId, requestName });
        this.timeoutMs = timeoutMs;
    }
}

export class RequestCancelledError extends RequestError {
    override readonly name = "RequestCancelledError";
    readonly reason: string | undefined;

    constructor(requestName: string, requestId: string, reason?: string) {
        super(reason ? `Request "${requestName}" cancelled: ${reason}` : `Request "${requestName}" cancelled`, {
            requestId,
            requestName,
        });
        this.reason = reason;
    }
}

export class RequestNotFoundError extends RequestError {
    override readonly name = "RequestNotFoundError";

    constructor(requestId: string) {
        super(`Request "${requestId}" not found`, { requestId });
    }
}

export class RequestAlreadyResolvedError extends RequestError {
    override readonly name = "RequestAlreadyResolvedError";
    readonly currentStatus: TerminalRequestStatus;

    constructor(requestName: string, requestId: string, currentStatus: TerminalRequestStatus) {
        super(`Request "${requestName}" is already ${currentStatus}`, { requestId, requestName });
        this.currentStatus = currentStatus;
    }
}

export function normalizeError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error), { cause: error });
}
