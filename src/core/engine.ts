import { createBranchFlowContext, createFlowContext, createStepContext } from "./context.ts";
import { FlowEngineError, FlowStopSignal } from "./errors.ts";
import { compose } from "./middleware.ts";
import { NoopReporter, type Reporter } from "./reporter.ts";
import { computeRetryDelay, createLinkedAbortController, runWithTimeout, wait } from "./retry.ts";
import { MemoryStateStore, mergeBranchChanges } from "./state.ts";
import type {
    ErrorMeta,
    ErrorResolution,
    FlowContext,
    FlowDefinition,
    FlowEngineConfig,
    FlowHandle,
    FlowNode,
    FlowStatus,
    ParallelNode,
    RunCompletionStatus,
    RunResult,
    StateShape,
    StepContext,
    StepNode,
    StepRunResult,
} from "./types.ts";

interface PauseGate {
    pausedPromise: Promise<void>;
    promise: Promise<void>;
    resolve: () => void;
    resolvePaused: () => void;
}

interface ActiveRun<TParams, TState extends StateShape> {
    abortController: AbortController;
    completionPromise: Promise<RunResult<TState>>;
    context: FlowContext<TParams, TState>;
    failure?: Error;
    flow: FlowDefinition<TParams, TState>;
    pauseGate: PauseGate | null;
    rejectCompletion: (error: unknown) => void;
    reporter: Reporter;
    resolveCompletion: (result: RunResult<TState>) => void;
    runId: string;
    state: MemoryStateStore<TState>;
    status: FlowStatus;
    stepResults: StepRunResult[];
    stopReason?: string;
}

interface BranchResult<TState extends StateShape> {
    patch: Partial<TState>;
}

export class FlowEngine {
    private readonly flows = new Map<string, FlowDefinition<any, any>>();
    private readonly activeRuns = new Map<string, ActiveRun<any, any>>();
    private readonly reporter: Reporter;

    constructor(config: FlowEngineConfig = {}) {
        this.reporter = config.reporter ?? new NoopReporter();
    }

    register<TParams, TState extends StateShape>(
        flow: FlowDefinition<TParams, TState>
    ): FlowDefinition<TParams, TState> {
        if (this.flows.has(flow.id)) {
            throw new FlowEngineError(`Flow "${flow.id}" is already registered`);
        }

        this.flows.set(flow.id, flow);
        return flow;
    }

    start<TParams, TState extends StateShape>(
        flowOrId: string | FlowDefinition<TParams, TState>,
        params: TParams
    ): FlowHandle<TState> {
        const flow = this.resolveFlow(flowOrId);
        const runId = crypto.randomUUID();
        const abortController = new AbortController();
        const state = new MemoryStateStore<TState>(this.resolveInitialState(flow));
        const context = createFlowContext({
            flowId: flow.id,
            flowName: flow.name,
            runId,
            params,
            state,
            reporter: this.reporter,
            signal: abortController.signal,
        });

        const {
            promise: completionPromise,
            resolve: resolveCompletion,
            reject: rejectCompletion,
        } = Promise.withResolvers<RunResult<TState>>();

        const activeRun: ActiveRun<TParams, TState> = {
            runId,
            flow,
            reporter: this.reporter,
            state,
            context,
            abortController,
            status: "running",
            pauseGate: null,
            completionPromise,
            resolveCompletion,
            rejectCompletion,
            stepResults: [],
        };

        this.activeRuns.set(runId, activeRun);

        this.executeFlow(activeRun).catch((error) => {
            activeRun.rejectCompletion(error);
            this.activeRuns.delete(runId);
        });

        return this.createRunHandle(activeRun);
    }

    async run<TParams, TState extends StateShape>(
        flowOrId: string | FlowDefinition<TParams, TState>,
        params: TParams
    ): Promise<RunResult<TState>> {
        return await this.start(flowOrId, params).join();
    }

    private resolveFlow<TParams, TState extends StateShape>(
        flowOrId: string | FlowDefinition<TParams, TState>
    ): FlowDefinition<TParams, TState> {
        if (typeof flowOrId !== "string") {
            return flowOrId;
        }

        const flow = this.flows.get(flowOrId);
        if (!flow) {
            throw new FlowEngineError(`Flow "${flowOrId}" is not registered`);
        }

        return flow as FlowDefinition<TParams, TState>;
    }

    private resolveInitialState<TState extends StateShape>(
        flow: FlowDefinition<any, TState>
    ): Partial<TState> | undefined {
        if (!flow.initialState) {
            return undefined;
        }

        return typeof flow.initialState === "function" ? flow.initialState() : flow.initialState;
    }

    private async executeFlow<TParams, TState extends StateShape>(
        activeRun: ActiveRun<TParams, TState>
    ): Promise<void> {
        const startedAt = Date.now();
        let finalStatus: RunCompletionStatus = "completed";
        let completionResult: RunResult<TState> | undefined;

        try {
            this.reporter.report({
                kind: "flow:start",
                flowId: activeRun.flow.id,
                flowName: activeRun.flow.name,
                runId: activeRun.runId,
                timestamp: new Date(),
                params: activeRun.context.params as Record<string, unknown>,
            });

            await activeRun.flow.onStart?.(activeRun.context);
            await this.executeNodes(activeRun.flow.steps, activeRun.context, activeRun);

            if (activeRun.abortController.signal.aborted) {
                finalStatus = "cancelled";
            }

            if (finalStatus === "completed") {
                await activeRun.flow.onSuccess?.(
                    activeRun.context,
                    this.buildRunResult(activeRun, finalStatus, startedAt)
                );
            }
        } catch (error) {
            if (error instanceof FlowStopSignal) {
                activeRun.stopReason = error.reason;
                finalStatus = activeRun.abortController.signal.aborted ? "cancelled" : "completed";

                if (finalStatus === "completed") {
                    await activeRun.flow.onSuccess?.(
                        activeRun.context,
                        this.buildRunResult(activeRun, finalStatus, startedAt)
                    );
                }
            } else {
                const failure = this.toError(error);
                activeRun.failure = failure;
                finalStatus = activeRun.abortController.signal.aborted ? "cancelled" : "failed";

                try {
                    if (finalStatus === "failed") {
                        await activeRun.flow.onFailure?.(activeRun.context, failure);
                    }
                } catch (hookError) {
                    activeRun.context.log.error("onFailure hook threw", {
                        error: this.toError(hookError).message,
                    });
                }
            }
        } finally {
            const eventResult = this.buildRunResult(activeRun, finalStatus, startedAt);

            activeRun.status = eventResult.status;

            this.reporter.report({
                kind: "flow:end",
                flowId: activeRun.flow.id,
                flowName: activeRun.flow.name,
                runId: activeRun.runId,
                timestamp: new Date(),
                status: eventResult.status,
                durationMs: eventResult.durationMs,
                error: eventResult.error,
                stopReason: eventResult.stopReason,
                cancelReason: eventResult.cancelReason,
            });

            try {
                await activeRun.flow.onComplete?.(activeRun.context, eventResult);
            } catch (hookError) {
                activeRun.context.log.error("onComplete hook threw", {
                    error: this.toError(hookError).message,
                });
            }

            completionResult = this.buildRunResult(activeRun, finalStatus, startedAt);
            activeRun.status = completionResult.status;

            if (activeRun.pauseGate) {
                activeRun.pauseGate.resolvePaused();
                activeRun.pauseGate.resolve();
                activeRun.pauseGate = null;
            }

            this.activeRuns.delete(activeRun.runId);
            activeRun.resolveCompletion(completionResult);
        }
    }

    private async executeNodes<TParams, TState extends StateShape>(
        nodes: FlowNode<TParams, TState>[],
        context: FlowContext<TParams, TState>,
        activeRun: ActiveRun<TParams, TState>
    ): Promise<void> {
        for (const node of nodes) {
            if (activeRun.abortController.signal.aborted) {
                return;
            }

            await this.awaitPauseIfNeeded(activeRun);
            await this.executeNode(node, context, activeRun);
        }
    }

    private async executeNode<TParams, TState extends StateShape>(
        node: FlowNode<TParams, TState>,
        context: FlowContext<TParams, TState>,
        activeRun: ActiveRun<TParams, TState>
    ): Promise<void> {
        switch (node.kind) {
            case "step":
                await this.executeStep(node, context, activeRun);
                return;
            case "sequence":
                await this.executeNodes(node.nodes, context, activeRun);
                return;
            case "parallel":
                await this.executeParallel(node, context, activeRun);
                return;
        }
    }

    private async executeStep<TParams, TState extends StateShape>(
        step: StepNode<TParams, TState>,
        context: FlowContext<TParams, TState>,
        activeRun: ActiveRun<TParams, TState>
    ): Promise<void> {
        const startedAt = Date.now();
        const flowMiddleware = activeRun.flow.middleware ?? [];
        const stepMiddleware = step.use ?? [];
        const pipeline = compose([...flowMiddleware, ...stepMiddleware]);
        const attempts = Math.max(1, step.retry?.attempts ?? 1);
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            const attemptStartedAt = Date.now();
            const attemptController = createLinkedAbortController(context.signal);
            const stepContext = createStepContext(
                context,
                activeRun.reporter,
                { id: step.id, name: step.name },
                attempt,
                attemptController.signal
            );

            this.reporter.report({
                kind: "step:start",
                flowId: context.flow.id,
                runId: context.runId,
                timestamp: new Date(),
                stepId: step.id,
                stepName: step.name,
                attempt,
                attempts,
            });

            try {
                const task = pipeline(stepContext, async () => {
                    await step.run(stepContext);
                });

                if (step.timeoutMs !== undefined) {
                    await runWithTimeout(task, step.timeoutMs, step.name, () => {
                        attemptController.abort("step timeout");
                    });
                } else {
                    await task;
                }

                const stepResult: StepRunResult = {
                    stepId: step.id,
                    stepName: step.name,
                    status: "completed",
                    attempts: attempt,
                    durationMs: Date.now() - startedAt,
                };

                activeRun.stepResults.push(stepResult);
                this.reporter.report({
                    kind: "step:end",
                    flowId: context.flow.id,
                    runId: context.runId,
                    timestamp: new Date(),
                    stepId: step.id,
                    stepName: step.name,
                    attempt,
                    status: "completed",
                    attempts,
                    durationMs: Date.now() - attemptStartedAt,
                });
                return;
            } catch (error) {
                if (error instanceof FlowStopSignal) {
                    const stepResult: StepRunResult = {
                        stepId: step.id,
                        stepName: step.name,
                        status: "completed",
                        attempts: attempt,
                        durationMs: Date.now() - startedAt,
                    };

                    activeRun.stepResults.push(stepResult);
                    this.reporter.report({
                        kind: "step:end",
                        flowId: context.flow.id,
                        runId: context.runId,
                        timestamp: new Date(),
                        stepId: step.id,
                        stepName: step.name,
                        attempt,
                        status: "completed",
                        attempts,
                        durationMs: Date.now() - attemptStartedAt,
                    });
                    throw error;
                }

                lastError = this.toError(error);

                if (attempt < attempts) {
                    this.reporter.report({
                        kind: "step:end",
                        flowId: context.flow.id,
                        runId: context.runId,
                        timestamp: new Date(),
                        stepId: step.id,
                        stepName: step.name,
                        attempt,
                        status: "failed",
                        attempts,
                        durationMs: Date.now() - attemptStartedAt,
                        error: lastError,
                    });

                    const delayMs = computeRetryDelay(step.retry ?? { attempts }, attempt - 1);

                    this.reporter.report({
                        kind: "step:retry",
                        flowId: context.flow.id,
                        runId: context.runId,
                        timestamp: new Date(),
                        stepId: step.id,
                        stepName: step.name,
                        attempt,
                        attempts,
                        delayMs,
                        error: lastError,
                    });

                    await wait(delayMs, context.signal);
                    continue;
                }

                const resolution = await this.resolveErrorResolution(step, lastError, stepContext, {
                    attempt,
                    attempts,
                });

                if (resolution === "skip") {
                    const stepResult: StepRunResult = {
                        stepId: step.id,
                        stepName: step.name,
                        status: "skipped",
                        attempts: attempt,
                        durationMs: Date.now() - startedAt,
                        error: lastError,
                    };

                    activeRun.stepResults.push(stepResult);
                    this.reporter.report({
                        kind: "step:end",
                        flowId: context.flow.id,
                        runId: context.runId,
                        timestamp: new Date(),
                        stepId: step.id,
                        stepName: step.name,
                        attempt,
                        status: "skipped",
                        attempts,
                        durationMs: Date.now() - attemptStartedAt,
                        error: lastError,
                    });
                    return;
                }

                const stepResult: StepRunResult = {
                    stepId: step.id,
                    stepName: step.name,
                    status: "failed",
                    attempts: attempt,
                    durationMs: Date.now() - startedAt,
                    error: lastError,
                };

                activeRun.stepResults.push(stepResult);
                this.reporter.report({
                    kind: "step:end",
                    flowId: context.flow.id,
                    runId: context.runId,
                    timestamp: new Date(),
                    stepId: step.id,
                    stepName: step.name,
                    attempt,
                    status: "failed",
                    attempts,
                    durationMs: Date.now() - attemptStartedAt,
                    error: lastError,
                });

                throw lastError;
            }
        }
    }

    private async executeParallel<TParams, TState extends StateShape>(
        node: ParallelNode<TParams, TState>,
        context: FlowContext<TParams, TState>,
        activeRun: ActiveRun<TParams, TState>
    ): Promise<void> {
        const groupController = createLinkedAbortController(context.signal);
        const concurrency = Math.max(1, node.concurrency ?? node.nodes.length);
        const tasks = node.nodes.map((child) => async (): Promise<BranchResult<TState>> => {
            const branchState = activeRun.state.fork();
            const branchContext = createBranchFlowContext(
                context,
                activeRun.reporter,
                branchState,
                groupController.signal
            );

            await this.executeNode(child, branchContext, activeRun);
            return { patch: branchState.changes() };
        });

        const settled = await this.runTaskPool(tasks, concurrency, node.mode, (error) => {
            groupController.abort(this.toError(error).message);
        });

        const failures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");

        if (failures.length > 0) {
            if (failures[0]?.reason instanceof FlowStopSignal) {
                throw failures[0].reason;
            }

            if (context.signal.aborted || activeRun.abortController.signal.aborted) {
                return;
            }

            if (node.mode === "all-settled") {
                throw new AggregateError(
                    failures.map((failure) => failure.reason),
                    `${failures.length} parallel branch(es) failed`
                );
            }

            throw this.toError(failures[0]?.reason);
        }

        const patches = settled
            .filter((entry): entry is PromiseFulfilledResult<BranchResult<TState>> => entry.status === "fulfilled")
            .map((entry) => entry.value.patch);

        context.state.patch(mergeBranchChanges(patches, node.merge));
    }

    private async runTaskPool<T>(
        tasks: Array<() => Promise<T>>,
        concurrency: number,
        mode: "fail-fast" | "all-settled",
        onFailure: (error: unknown) => void
    ): Promise<PromiseSettledResult<T>[]> {
        const results: PromiseSettledResult<T>[] = new Array(tasks.length);
        let nextIndex = 0;

        const worker = async (): Promise<void> => {
            while (nextIndex < tasks.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;

                if (mode === "fail-fast" && results.some((entry) => entry?.status === "rejected")) {
                    return;
                }

                try {
                    const value = await tasks[currentIndex]!();
                    results[currentIndex] = { status: "fulfilled", value };
                } catch (error) {
                    results[currentIndex] = { status: "rejected", reason: error };
                    onFailure(error);

                    if (mode === "fail-fast") {
                        return;
                    }
                }
            }
        };

        const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());

        await Promise.allSettled(workers);
        return results.filter(Boolean);
    }

    private async resolveErrorResolution<TParams, TState extends StateShape>(
        step: StepNode<TParams, TState>,
        error: Error,
        context: StepContext<TParams, TState>,
        meta: ErrorMeta
    ): Promise<ErrorResolution> {
        if (!step.onError) {
            return "fail";
        }

        if (typeof step.onError === "string") {
            return step.onError;
        }

        try {
            return await step.onError(error, context, meta);
        } catch (resolutionError) {
            context.log.error("onError resolver threw", {
                error: this.toError(resolutionError).message,
            });
            return "fail";
        }
    }

    private buildRunResult<TParams, TState extends StateShape>(
        activeRun: ActiveRun<TParams, TState>,
        status: RunCompletionStatus,
        startedAt: number
    ): RunResult<TState> {
        return {
            flowId: activeRun.flow.id,
            flowName: activeRun.flow.name,
            runId: activeRun.runId,
            status,
            state: activeRun.state.snapshot(),
            durationMs: Date.now() - startedAt,
            steps: [...activeRun.stepResults],
            error: status === "failed" ? activeRun.failure : undefined,
            stopReason: activeRun.stopReason,
            cancelReason:
                status === "cancelled" ? String(activeRun.abortController.signal.reason ?? "Cancelled") : undefined,
        };
    }

    private async awaitPauseIfNeeded<TParams, TState extends StateShape>(
        activeRun: ActiveRun<TParams, TState>
    ): Promise<void> {
        if (!activeRun.pauseGate) {
            return;
        }

        activeRun.status = "paused";
        activeRun.pauseGate.resolvePaused();
        await activeRun.pauseGate.promise;

        activeRun.status = activeRun.abortController.signal.aborted ? "cancelled" : "running";
    }

    private createPauseGate(): PauseGate {
        const { promise, resolve } = Promise.withResolvers<void>();
        const { promise: pausedPromise, resolve: resolvePaused } = Promise.withResolvers<void>();
        return { promise, resolve, pausedPromise, resolvePaused };
    }

    private createRunHandle<TParams, TState extends StateShape>(
        activeRun: ActiveRun<TParams, TState>
    ): FlowHandle<TState> {
        return {
            runId: activeRun.runId,
            flowId: activeRun.flow.id,
            status: () => activeRun.status,
            join: () => activeRun.completionPromise,
            cancel: async (reason?: string) => {
                if (
                    activeRun.status === "completed" ||
                    activeRun.status === "failed" ||
                    activeRun.status === "cancelled"
                ) {
                    return;
                }

                activeRun.status = "cancelled";
                activeRun.abortController.abort(reason ?? "Cancelled");

                if (activeRun.pauseGate) {
                    activeRun.pauseGate.resolvePaused();
                    activeRun.pauseGate.resolve();
                    activeRun.pauseGate = null;
                }
            },
            pause: async () => {
                if (activeRun.status !== "running" || activeRun.pauseGate) {
                    return;
                }

                const gate = this.createPauseGate();
                activeRun.pauseGate = gate;
                await gate.pausedPromise;
            },
            resume: async () => {
                if (!activeRun.pauseGate) {
                    return;
                }

                activeRun.pauseGate.resolve();
                activeRun.pauseGate = null;
            },
        };
    }

    private toError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }
}
