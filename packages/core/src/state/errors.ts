/**
 * state/errors.ts — State merge errors
 *
 * Layer: L2. Raised while merging forked branch stores back into the parent.
 */

import { FlowEngineError } from "../core/errors.ts";

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
