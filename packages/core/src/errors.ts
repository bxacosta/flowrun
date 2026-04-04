export class FlowEngineError extends Error {
    override readonly name: string = "FlowEngineError";
}

export function normalizeError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error), { cause: error });
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

export class InvalidItemsError extends FlowEngineError {
    override readonly name = "InvalidItemsError";

    constructor(nodeName: string) {
        super(`Node "${nodeName}": items function must return an array`);
    }
}

export class DuplicateNodeNameError extends FlowEngineError {
    override readonly name = "DuplicateNodeNameError";

    constructor(nodeName: string, parentName: string) {
        super(`Duplicate node name "${nodeName}" among siblings in "${parentName}"`);
    }
}
