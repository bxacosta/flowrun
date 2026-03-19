import type { FlowHandle, RunResult, RunStatus, StateShape } from "../core/types.ts";
import type { RunController } from "./run-controller.ts";

export class FlowHandleImpl<TState extends StateShape> implements FlowHandle<TState> {
    private readonly resultPromise: Promise<RunResult<TState>>;
    private readonly runController: RunController;

    readonly flowId: string;
    readonly runId: string;

    constructor(
        flowId: string,
        runId: string,
        runController: RunController,
        resultPromise: Promise<RunResult<TState>>
    ) {
        this.flowId = flowId;
        this.resultPromise = resultPromise;
        this.runController = runController;
        this.runId = runId;
    }

    cancel(reason?: string): void {
        this.runController.cancel(reason);
    }

    join(): Promise<RunResult<TState>> {
        return this.resultPromise;
    }

    pause(): Promise<void> {
        return this.runController.pause();
    }

    resume(): void {
        this.runController.resume();
    }

    status(): RunStatus {
        return this.runController.status();
    }
}
