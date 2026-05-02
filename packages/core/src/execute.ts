import { executeContinueBranches, executeFailFastBranches } from "./concurrency.ts";
import type { ExecutionContext, FlowProgress, FlowRuntime } from "./context.ts";
import { buildItemsContext, buildTaskContext } from "./context.ts";
import { InvalidItemsError, normalizeError } from "./errors.ts";
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

function computeRetryDelay(options: RetryConfig, attempt: number): number {
    const base =
        options.backoff === "exponential" ? options.delayMs * (options.factor ?? 2) ** (attempt - 1) : options.delayMs;
    const capped = options.maxDelayMs === undefined ? base : Math.min(base, options.maxDelayMs);
    return options.jitter ? capped / 2 + Math.random() * (capped / 2) : capped;
}

function recordTaskResult(
    progress: FlowProgress,
    node: TaskNodeDefinition,
    path: string,
    attempts: number,
    duration: number,
    status: "failed" | "skipped" | "success",
    error: Error | null,
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
    attempt: number,
    iteration?: { index: number; item: unknown }
): Promise<Error | null> {
    signal.throwIfAborted();

    const { bus, flowName, runId } = executionContext.runtime;
    const attemptBase = { attempt, flowName, index: iteration?.index, nodeName: node.name, runId };
    const attemptStart = Date.now();

    await bus.publish("node:task:attempt:started", attemptBase, { source: "system" });

    try {
        const context = buildTaskContext(executionContext.runtime, state, signal, node.name, attempt, iteration);
        await compose(node.middleware, context, () => node.run(context));
        await bus.publish(
            "node:task:attempt:ended",
            { ...attemptBase, duration: Date.now() - attemptStart, status: "success" },
            { source: "system" }
        );
        return null;
    } catch (error) {
        const normalized = normalizeError(error);
        await bus.publish(
            "node:task:attempt:ended",
            { ...attemptBase, duration: Date.now() - attemptStart, error: normalized, status: "failed" },
            { source: "system" }
        );
        return normalized;
    }
}

async function executeTask(
    node: TaskNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    const { bus, flowName, runId } = executionContext.runtime;
    const nodeBase = { flowName, index: iteration?.index, nodeName: node.name, runId };
    const maxAttempts = node.retry?.attempts ?? 1;
    const path = [...executionContext.pathSegments, node.name].join("/");
    const taskStart = Date.now();

    await bus.publish("node:task:started", { ...nodeBase, maxAttempts }, { source: "system" });

    let attempts = 0;
    let lastError: Error | null = null;

    try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const error = await runSingleAttempt(node, executionContext, state, signal, attempt, iteration);
            attempts = attempt;

            if (!error) {
                lastError = null;
                break;
            }

            lastError = error;
            if (signal.aborted) {
                break;
            }

            const isLastAttempt = attempt === maxAttempts;
            const shouldRetry = node.retry?.retryOn ? node.retry.retryOn(error, attempt) : true;
            if (isLastAttempt || !shouldRetry || !node.retry) {
                break;
            }

            const nextDelayMs = computeRetryDelay(node.retry, attempt);
            await bus.publish("node:task:retried", { ...nodeBase, attempt, error, nextDelayMs }, { source: "system" });
            await sleepWithSignal(nextDelayMs, signal);
            await executionContext.pauseGate.waitIfPaused();
        }
    } catch (abortError) {
        lastError = normalizeError(abortError);
    }

    const duration = Date.now() - taskStart;

    if (!lastError) {
        await bus.publish(
            "node:task:ended",
            { ...nodeBase, attempts, duration, status: "success" },
            { source: "system" }
        );
        recordTaskResult(executionContext.progress, node, path, attempts, duration, "success", null, iteration);
        return;
    }

    if (!signal.aborted && node.onError === "skip") {
        await bus.publish(
            "node:task:ended",
            { ...nodeBase, attempts, duration, error: lastError, status: "skipped" },
            { source: "system" }
        );
        recordTaskResult(executionContext.progress, node, path, attempts, duration, "skipped", lastError, iteration);
        return;
    }

    await bus.publish(
        "node:task:ended",
        { ...nodeBase, attempts, duration, error: lastError, status: "failed" },
        { source: "system" }
    );
    recordTaskResult(executionContext.progress, node, path, attempts, duration, "failed", lastError, iteration);
    throw lastError;
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
    provide: AnyProvide | undefined,
    cleanup: AnyCleanup | undefined,
    meta: unknown,
    iteration: { index: number; item: unknown } | undefined,
    execute: (runtime: FlowRuntime) => Promise<void>
): Promise<void> {
    let branchRuntime = executionContext.runtime;

    if (provide) {
        const provideContext = buildItemsContext(branchRuntime, state, signal, iteration, "provide");
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
                const cleanupContext = buildItemsContext(branchRuntime, state, signal, iteration, "cleanup");
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
    const { bus, flowName, runId } = executionContext.runtime;
    const parallelStart = Date.now();

    await bus.publish("node:parallel:started", { flowName, nodeName: node.name, runId }, { source: "system" });

    const { cleanup, controller } = createChildController(signal);

    try {
        const plan: BranchPlan = { branches: [], branchProgresses: [], forks: [] };
        const childPathSegments = [...executionContext.pathSegments, node.name];

        for (const [branchIndex, child] of node.nodes.entries()) {
            const forkedStore = state.fork();
            const branchProgress: FlowProgress = { taskResults: [] };
            plan.forks.push({ label: child.name, store: forkedStore });
            plan.branchProgresses.push(branchProgress);
            plan.branches.push(async () => {
                const meta: ParallelMeta = { branchIndex, branchName: child.name, nodeName: node.name };
                await withLocalProvided(
                    executionContext,
                    forkedStore,
                    controller.signal,
                    node.provide,
                    node.cleanup,
                    meta,
                    iteration,
                    async (runtime) => {
                        await executeNode(
                            child,
                            {
                                pathSegments: childPathSegments,
                                pauseGate: executionContext.pauseGate,
                                progress: branchProgress,
                                runtime,
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

        if (outcome.errors.length > 0) {
            if (node.onError === "continue") {
                await bus.publish(
                    "node:parallel:ended",
                    {
                        duration: Date.now() - parallelStart,
                        errors: outcome.errors,
                        flowName,
                        nodeName: node.name,
                        runId,
                        status: "success",
                    },
                    { source: "system" }
                );
                return;
            }

            await bus.publish(
                "node:parallel:ended",
                {
                    duration: Date.now() - parallelStart,
                    errors: outcome.errors,
                    flowName,
                    nodeName: node.name,
                    runId,
                    status: "failed",
                },
                { source: "system" }
            );
            throw outcome.errors[0];
        }

        await bus.publish(
            "node:parallel:ended",
            { duration: Date.now() - parallelStart, flowName, nodeName: node.name, runId, status: "success" },
            { source: "system" }
        );
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
    const { bus, flowName, runId } = executionContext.runtime;
    const itemsContext = buildItemsContext(executionContext.runtime, state, signal, iteration, "items");
    const items = node.items(itemsContext);

    if (!Array.isArray(items)) {
        throw new InvalidItemsError(node.name);
    }

    const everyStart = Date.now();
    await bus.publish(
        "node:every:started",
        { flowName, nodeName: node.name, runId, totalItems: items.length },
        { source: "system" }
    );

    const { cleanup, controller } = createChildController(signal);

    try {
        const plan: BranchPlan = { branches: [], branchProgresses: [], forks: [] };

        for (const [itemIndex, item] of items.entries()) {
            const forkedStore = state.fork();
            const branchProgress: FlowProgress = { taskResults: [] };
            const itemIteration = { index: itemIndex, item };

            plan.forks.push({ label: itemIndex, store: forkedStore });
            plan.branchProgresses.push(branchProgress);
            plan.branches.push(async () => {
                const meta: EveryMeta = { index: itemIndex, item, nodeName: node.name };
                await withLocalProvided(
                    executionContext,
                    forkedStore,
                    controller.signal,
                    node.provide,
                    node.cleanup,
                    meta,
                    itemIteration,
                    async (runtime) => {
                        await executeNodes(
                            node.nodes,
                            {
                                pathSegments: [...executionContext.pathSegments, node.name, String(itemIndex)],
                                pauseGate: executionContext.pauseGate,
                                progress: branchProgress,
                                runtime,
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

        if (outcome.errors.length > 0) {
            if (node.onError === "continue") {
                await bus.publish(
                    "node:every:ended",
                    {
                        duration: Date.now() - everyStart,
                        errors: outcome.errors,
                        failedIndexes: outcome.failedIndexes,
                        flowName,
                        nodeName: node.name,
                        runId,
                        status: "success",
                        totalItems: items.length,
                    },
                    { source: "system" }
                );
                return;
            }

            await bus.publish(
                "node:every:ended",
                {
                    duration: Date.now() - everyStart,
                    errors: outcome.errors,
                    flowName,
                    nodeName: node.name,
                    runId,
                    status: "failed",
                    totalItems: items.length,
                },
                { source: "system" }
            );
            throw outcome.errors[0];
        }

        await bus.publish(
            "node:every:ended",
            {
                duration: Date.now() - everyStart,
                flowName,
                nodeName: node.name,
                runId,
                status: "success",
                totalItems: items.length,
            },
            { source: "system" }
        );
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
