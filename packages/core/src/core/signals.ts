/**
 * core/signals.ts — Control-flow signals
 *
 * Layer: L0 (core). These are not errors: they extend Error only to leverage
 * throw/catch for non-local control flow (skip a task, cancel a run) and are
 * deliberately NOT subclasses of FlowEngineError.
 */

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
