import { executeContinueBranches, executeFailFastBranches } from "./concurrency.ts";
import type { ExecutionContext, FlowProgress, FlowRuntime } from "./context.ts";
import { buildItemsContext, buildTaskContext } from "./context.ts";
import { InvalidItemsError, normalizeError, SkipSignal } from "./errors.ts";
import { createEmitMeta, type EmitMeta } from "./event-bus.ts";
import { compose } from "./middleware.ts";
import type {
    AnyCleanup,
    AnyProvide,
    ContainerErrorMode,
    EveryMeta,
    EveryNodeDefinition,
    NodeDefinition,
    ParallelMeta,
    ParallelNodeDefinition,
    RetryConfig,
    TaskNodeDefinition,
    TaskResult,
} from "./node.ts";
import { createChildController, sleepWithSignal } from "./signal.ts";
import type { AnyFlowStateStore, ForkEntry, MergeStrategy } from "./state.ts";
import { mergeForkedStores } from "./state.ts";
import { assertPlainObject } from "./validation.ts";

function runtimeMeta(
    runtime: FlowRuntime,
    location: {
        iteration?: { index: number; item: unknown };
        nodeName?: string;
        path?: readonly string[];
    }
): EmitMeta {
    return createEmitMeta("runtime", runtime, location);
}

function computeRetryDelay(options: RetryConfig, attempt: number): number {
    const base =
        options.backoff === "exponential" ? options.delayMs * (options.factor ?? 2) ** (attempt - 1) : options.delayMs;
    const capped = options.maxDelayMs === undefined ? base : Math.min(base, options.maxDelayMs);
    return options.jitter ? capped / 2 + Math.random() * (capped / 2) : capped;
}

type AttemptOutcome =
    | { error: Error; status: "failed" }
    | { reason: string | undefined; status: "skipped" }
    | { status: "success" };

function recordTaskResult(
    progress: FlowProgress,
    node: TaskNodeDefinition,
    path: string,
    attempts: number,
    duration: number,
    status: "failed" | "skipped" | "success",
    error: Error | null,
    reason: string | undefined,
    iteration?: { index: number; item: unknown }
): void {
    const result: TaskResult = {
        attempts,
        duration,
        nodeName: node.name,
        path,
        status,
    };
    if (error) {
        result.error = error;
    }
    if (reason !== undefined) {
        result.reason = reason;
    }
    if (iteration) {
        result.iteration = { index: iteration.index, item: iteration.item };
    }
    progress.taskResults.push(result);
}

async function runSingleAttempt(
    node: TaskNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    pathSegments: readonly string[],
    attempt: number,
    iteration?: { index: number; item: unknown }
): Promise<AttemptOutcome> {
    signal.throwIfAborted();

    const { runtime } = executionContext;
    const { bus } = runtime;
    const meta = runtimeMeta(runtime, { iteration, nodeName: node.name, path: pathSegments });
    const attemptStart = Date.now();

    bus.emit("node:task:attempt:started", { attempt }, meta);

    try {
        const context = buildTaskContext(runtime, state, signal, pathSegments, node.name, attempt, iteration);
        await compose(node.middleware, context, () => node.run(context));
        bus.emit(
            "node:task:attempt:ended",
            { attempt, durationMs: Date.now() - attemptStart, status: "success" },
            meta
        );
        return { status: "success" };
    } catch (error) {
        if (error instanceof SkipSignal) {
            bus.emit(
                "node:task:attempt:ended",
                { attempt, durationMs: Date.now() - attemptStart, reason: error.reason, status: "skipped" },
                meta
            );
            return { reason: error.reason, status: "skipped" };
        }
        const normalized = normalizeError(error);
        bus.emit(
            "node:task:attempt:ended",
            { attempt, durationMs: Date.now() - attemptStart, error: normalized, status: "failed" },
            meta
        );
        return { error: normalized, status: "failed" };
    }
}

async function runAttemptLoop(
    node: TaskNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    pathSegments: readonly string[],
    maxAttempts: number,
    iteration?: { index: number; item: unknown }
): Promise<{ attempts: number; outcome: AttemptOutcome }> {
    const { bus } = executionContext.runtime;
    const meta = runtimeMeta(executionContext.runtime, { iteration, nodeName: node.name, path: pathSegments });
    let attempts = 0;
    let outcome: AttemptOutcome = { error: new Error("task did not run"), status: "failed" };

    try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            outcome = await runSingleAttempt(node, executionContext, state, signal, pathSegments, attempt, iteration);
            attempts = attempt;

            if (outcome.status !== "failed") {
                break;
            }
            if (signal.aborted) {
                break;
            }

            const isLastAttempt = attempt === maxAttempts;
            const shouldRetry = node.retry?.retryOn ? node.retry.retryOn(outcome.error, attempt) : true;
            if (isLastAttempt || !shouldRetry || !node.retry) {
                break;
            }

            const nextDelayMs = computeRetryDelay(node.retry, attempt);
            bus.emit("node:task:retried", { attempt, error: outcome.error, nextDelayMs }, meta);
            await sleepWithSignal(nextDelayMs, signal);
            await executionContext.pauseGate.waitIfPaused();
        }
    } catch (abortError) {
        outcome = { error: normalizeError(abortError), status: "failed" };
    }

    return { attempts, outcome };
}

async function executeTask(
    node: TaskNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    const { runtime } = executionContext;
    const { bus } = runtime;
    const taskPathSegments = [...executionContext.pathSegments, node.name];
    const path = taskPathSegments.join("/");
    const meta = runtimeMeta(runtime, { iteration, nodeName: node.name, path: taskPathSegments });
    const maxAttempts = node.retry?.attempts ?? 1;
    const taskStart = Date.now();

    bus.emit("node:task:started", { maxAttempts }, meta);

    const { attempts, outcome } = await runAttemptLoop(
        node,
        executionContext,
        state,
        signal,
        taskPathSegments,
        maxAttempts,
        iteration
    );
    const durationMs = Date.now() - taskStart;

    if (outcome.status === "success") {
        bus.emit("node:task:ended", { attempts, durationMs, status: "success" }, meta);
        recordTaskResult(
            executionContext.progress,
            node,
            path,
            attempts,
            durationMs,
            "success",
            null,
            undefined,
            iteration
        );
        return;
    }

    if (outcome.status === "skipped") {
        bus.emit("node:task:ended", { attempts, durationMs, reason: outcome.reason, status: "skipped" }, meta);
        recordTaskResult(
            executionContext.progress,
            node,
            path,
            attempts,
            durationMs,
            "skipped",
            null,
            outcome.reason,
            iteration
        );
        return;
    }

    if (!signal.aborted && node.onError === "skip") {
        bus.emit("node:task:ended", { attempts, durationMs, error: outcome.error, status: "skipped" }, meta);
        recordTaskResult(
            executionContext.progress,
            node,
            path,
            attempts,
            durationMs,
            "skipped",
            outcome.error,
            undefined,
            iteration
        );
        return;
    }

    bus.emit("node:task:ended", { attempts, durationMs, error: outcome.error, status: "failed" }, meta);
    recordTaskResult(
        executionContext.progress,
        node,
        path,
        attempts,
        durationMs,
        "failed",
        outcome.error,
        undefined,
        iteration
    );
    throw outcome.error;
}

function mergeBranchProgresses(parent: FlowProgress, branches: readonly FlowProgress[]): void {
    for (const branch of branches) {
        parent.taskResults.push(...branch.taskResults);
    }
}

async function withLocalProvided(
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    branchPathSegments: readonly string[],
    provide: AnyProvide | undefined,
    cleanup: AnyCleanup | undefined,
    meta: unknown,
    iteration: { index: number; item: unknown } | undefined,
    execute: (runtime: FlowRuntime) => Promise<void>
): Promise<void> {
    let branchRuntime = executionContext.runtime;

    if (provide) {
        const provideContext = buildItemsContext(branchRuntime, state, signal, branchPathSegments, iteration);
        const localProvided = await provide(provideContext, meta);
        assertPlainObject(localProvided, "Container provide() must return a plain object");
        branchRuntime = {
            ...branchRuntime,
            provided: { ...branchRuntime.provided, ...localProvided },
        };
    }

    try {
        await execute(branchRuntime);
    } finally {
        if (cleanup) {
            try {
                const cleanupContext = buildItemsContext(branchRuntime, state, signal, branchPathSegments, iteration);
                await cleanup(cleanupContext, meta);
            } catch (cleanupError) {
                executionContext.runtime.log.error("cleanup failed", { error: cleanupError });
            }
        }
    }
}

interface BranchPlan {
    branches: (() => Promise<void>)[];
    branchProgresses: FlowProgress[];
    forks: ForkEntry[];
}

interface BranchOutcome {
    errors: Error[];
    failedIndexes: number[];
}

async function resolveBranches(
    plan: BranchPlan,
    parentProgress: FlowProgress,
    state: AnyFlowStateStore,
    controller: AbortController,
    onError: ContainerErrorMode,
    merge: MergeStrategy,
    concurrency: number
): Promise<BranchOutcome> {
    if (onError === "fail") {
        const firstError = await executeFailFastBranches(plan.branches, controller, concurrency);
        mergeBranchProgresses(parentProgress, plan.branchProgresses);
        if (firstError) {
            return { errors: [firstError], failedIndexes: [] };
        }
        mergeForkedStores(state, plan.forks, merge);
        return { errors: [], failedIndexes: [] };
    }

    const { errors: branchErrors, successfulIndexes } = await executeContinueBranches(plan.branches, concurrency);
    mergeBranchProgresses(parentProgress, plan.branchProgresses);

    const successfulForks = successfulIndexes
        .map((index) => plan.forks[index])
        .filter((fork): fork is ForkEntry => fork !== undefined);
    mergeForkedStores(state, successfulForks, merge);

    return {
        errors: branchErrors.map((entry) => entry.error),
        failedIndexes: branchErrors.map((entry) => entry.index),
    };
}

async function executeParallel(
    node: ParallelNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    const { runtime } = executionContext;
    const { bus } = runtime;
    const containerPathSegments = [...executionContext.pathSegments, node.name];
    const meta = runtimeMeta(runtime, { iteration, nodeName: node.name, path: containerPathSegments });
    const parallelStart = Date.now();

    bus.emit("node:parallel:started", undefined, meta);

    const { cleanup, controller } = createChildController(signal);

    try {
        const plan: BranchPlan = { branches: [], branchProgresses: [], forks: [] };

        for (const [branchIndex, child] of node.nodes.entries()) {
            const forkedStore = state.fork();
            const branchProgress: FlowProgress = { taskResults: [] };
            const branchPathSegments = [...containerPathSegments, child.name];
            plan.forks.push({ label: child.name, store: forkedStore });
            plan.branchProgresses.push(branchProgress);
            plan.branches.push(async () => {
                const branchMeta: ParallelMeta = { branchIndex, branchName: child.name, nodeName: node.name };
                await withLocalProvided(
                    executionContext,
                    forkedStore,
                    controller.signal,
                    branchPathSegments,
                    node.resource?.provide,
                    node.resource?.cleanup,
                    branchMeta,
                    iteration,
                    async (branchRuntime) => {
                        await executeNode(
                            child,
                            {
                                pathSegments: containerPathSegments,
                                pauseGate: executionContext.pauseGate,
                                progress: branchProgress,
                                runtime: branchRuntime,
                            },
                            forkedStore,
                            controller.signal,
                            iteration
                        );
                    }
                );
            });
        }

        const outcome = await resolveBranches(
            plan,
            executionContext.progress,
            state,
            controller,
            node.onError,
            node.merge,
            plan.branches.length
        );

        const durationMs = Date.now() - parallelStart;

        if (outcome.errors.length === 0) {
            bus.emit("node:parallel:ended", { durationMs, status: "success" }, meta);
        } else if (node.onError === "continue") {
            bus.emit("node:parallel:ended", { durationMs, errors: outcome.errors, status: "success" }, meta);
        } else {
            bus.emit("node:parallel:ended", { durationMs, errors: outcome.errors, status: "failed" }, meta);
            throw outcome.errors[0];
        }
    } finally {
        cleanup();
    }
}

async function executeEvery(
    node: EveryNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    const { runtime } = executionContext;
    const { bus } = runtime;
    const containerPathSegments = [...executionContext.pathSegments, node.name];
    const meta = runtimeMeta(runtime, { iteration, nodeName: node.name, path: containerPathSegments });

    const itemsContext = buildItemsContext(runtime, state, signal, containerPathSegments, iteration);
    const items = node.items(itemsContext);

    if (!Array.isArray(items)) {
        throw new InvalidItemsError(node.name);
    }

    const everyStart = Date.now();
    bus.emit("node:every:started", { totalItems: items.length }, meta);

    const { cleanup, controller } = createChildController(signal);

    try {
        const plan: BranchPlan = { branches: [], branchProgresses: [], forks: [] };

        for (const [itemIndex, item] of items.entries()) {
            const forkedStore = state.fork();
            const branchProgress: FlowProgress = { taskResults: [] };
            const itemIteration = { index: itemIndex, item };
            const branchPathSegments = [...containerPathSegments, String(itemIndex)];

            plan.forks.push({ label: itemIndex, store: forkedStore });
            plan.branchProgresses.push(branchProgress);
            plan.branches.push(async () => {
                const branchMeta: EveryMeta = { index: itemIndex, item, nodeName: node.name };
                await withLocalProvided(
                    executionContext,
                    forkedStore,
                    controller.signal,
                    branchPathSegments,
                    node.resource?.provide,
                    node.resource?.cleanup,
                    branchMeta,
                    itemIteration,
                    async (branchRuntime) => {
                        await executeNodes(
                            node.nodes,
                            {
                                pathSegments: branchPathSegments,
                                pauseGate: executionContext.pauseGate,
                                progress: branchProgress,
                                runtime: branchRuntime,
                            },
                            forkedStore,
                            controller.signal,
                            itemIteration
                        );
                    }
                );
            });
        }

        const effectiveConcurrency =
            node.concurrency === Number.POSITIVE_INFINITY
                ? plan.branches.length
                : Math.min(node.concurrency, plan.branches.length);

        const outcome = await resolveBranches(
            plan,
            executionContext.progress,
            state,
            controller,
            node.onError,
            node.merge,
            effectiveConcurrency
        );

        const durationMs = Date.now() - everyStart;

        if (outcome.errors.length === 0) {
            bus.emit("node:every:ended", { durationMs, status: "success", totalItems: items.length }, meta);
        } else if (node.onError === "continue") {
            bus.emit(
                "node:every:ended",
                {
                    durationMs,
                    errors: outcome.errors,
                    failedIndexes: outcome.failedIndexes,
                    status: "success",
                    totalItems: items.length,
                },
                meta
            );
        } else {
            bus.emit(
                "node:every:ended",
                { durationMs, errors: outcome.errors, status: "failed", totalItems: items.length },
                meta
            );
            throw outcome.errors[0];
        }
    } finally {
        cleanup();
    }
}

async function executeNode(
    node: NodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    signal.throwIfAborted();

    switch (node.type) {
        case "every":
            await executeEvery(node, executionContext, state, signal, iteration);
            return;
        case "parallel":
            await executeParallel(node, executionContext, state, signal, iteration);
            return;
        case "task":
            await executeTask(node, executionContext, state, signal, iteration);
            return;
        default:
            throw new Error(`Unknown node type: ${(node as NodeDefinition).type}`);
    }
}

export async function executeNodes(
    nodes: readonly NodeDefinition[],
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    for (const node of nodes) {
        await executionContext.pauseGate.waitIfPaused();
        signal.throwIfAborted();
        await executeNode(node, executionContext, state, signal, iteration);
    }
}
