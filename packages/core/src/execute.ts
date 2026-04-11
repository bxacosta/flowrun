import { executeContinueBranches, executeFailFastBranches } from "./concurrency.ts";
import type { ExecutionContext, FlowProgress } from "./context.ts";
import { buildItemsContext, buildTaskContext } from "./context.ts";
import { InvalidItemsError, normalizeError } from "./errors.ts";
import { compose } from "./middleware.ts";
import { createChildController, sleepWithSignal } from "./signal.ts";
import type { ForkEntry } from "./state.ts";
import { mergeForkedStores } from "./state.ts";
import type {
    AnyCleanupProvided,
    AnyFlowStateStore,
    AnyForkProvided,
    ContainerErrorMode,
    EveryForkMeta,
    EveryNodeDefinition,
    MergeStrategy,
    NodeDefinition,
    ParallelForkMeta,
    ParallelNodeDefinition,
    RetryConfig,
    TaskNodeDefinition,
    TaskResult,
} from "./types.ts";

// ── Retry Helpers ────────────────────────────────────────────────────

function computeRetryDelay(options: RetryConfig, attempt: number): number {
    const base =
        options.backoff === "exponential" ? options.delayMs * (options.factor ?? 2) ** (attempt - 1) : options.delayMs;
    const capped = options.maxDelayMs === undefined ? base : Math.min(base, options.maxDelayMs);
    return options.jitter ? capped / 2 + Math.random() * (capped / 2) : capped;
}

// ── Task Result Recorder ─────────────────────────────────────────────

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

// ── Task Executors ───────────────────────────────────────────────────

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

    await bus.publish("node:task:attempt:start", attemptBase, { source: "system" });
    const attemptStart = Date.now();

    try {
        const context = buildTaskContext(executionContext.runtime, state, signal, node.name, attempt, iteration);
        await compose(node.middleware, context, () => node.handler(context));
        await bus.publish(
            "node:task:attempt:end",
            { ...attemptBase, duration: Date.now() - attemptStart, status: "success" },
            { source: "system" }
        );
        return null;
    } catch (error) {
        const normalized = normalizeError(error);
        await bus.publish(
            "node:task:attempt:end",
            {
                ...attemptBase,
                duration: Date.now() - attemptStart,
                error: normalized,
                status: "failed",
            },
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
    const taskStart = Date.now();
    const path = [...executionContext.pathSegments, node.name].join("/");

    await bus.publish("node:task:start", { ...nodeBase, maxAttempts }, { source: "system" });

    let lastError: Error | null = null;
    let attempts = 0;

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
            await bus.publish("node:task:retry", { ...nodeBase, attempt, error, nextDelayMs }, { source: "system" });
            await sleepWithSignal(nextDelayMs, signal);
            await executionContext.pauseGate.waitIfPaused();
        }
    } catch (abortError) {
        lastError = normalizeError(abortError);
    }

    const duration = Date.now() - taskStart;

    if (signal.aborted && lastError) {
        await bus.publish(
            "node:task:end",
            { ...nodeBase, attempts, duration, error: lastError, status: "failed" },
            { source: "system" }
        );
        recordTaskResult(executionContext.progress, node, path, attempts, duration, "failed", lastError, iteration);
        throw lastError;
    }

    if (!lastError) {
        await bus.publish(
            "node:task:end",
            { ...nodeBase, attempts, duration, status: "success" },
            { source: "system" }
        );
        recordTaskResult(executionContext.progress, node, path, attempts, duration, "success", null, iteration);
        return;
    }

    if (node.onError === "skip") {
        await bus.publish(
            "node:task:end",
            { ...nodeBase, attempts, duration, error: lastError, status: "skipped" },
            { source: "system" }
        );
        recordTaskResult(executionContext.progress, node, path, attempts, duration, "skipped", lastError, iteration);
        return;
    }

    await bus.publish(
        "node:task:end",
        { ...nodeBase, attempts, duration, error: lastError, status: "failed" },
        { source: "system" }
    );
    recordTaskResult(executionContext.progress, node, path, attempts, duration, "failed", lastError, iteration);
    throw lastError;
}

// ── Container Helpers ────────────────────────────────────────────────

function mergeBranchProgresses(parent: FlowProgress, branchProgresses: readonly FlowProgress[]): void {
    for (const branchProgress of branchProgresses) {
        parent.taskResults.push(...branchProgress.taskResults);
    }
}

async function withForkedProvided(
    executionContext: ExecutionContext,
    forkProvided: AnyForkProvided | undefined,
    cleanupProvided: AnyCleanupProvided | undefined,
    meta: unknown,
    execute: (branchRuntime: ExecutionContext["runtime"]) => Promise<void>
): Promise<void> {
    const branchProvided = forkProvided
        ? await forkProvided(executionContext.runtime.provided, meta)
        : executionContext.runtime.provided;
    const branchRuntime = forkProvided
        ? { ...executionContext.runtime, provided: branchProvided }
        : executionContext.runtime;

    try {
        await execute(branchRuntime);
    } finally {
        if (forkProvided && cleanupProvided) {
            try {
                await cleanupProvided(branchProvided, meta);
            } catch (cleanupError) {
                executionContext.runtime.log.error("cleanupProvided failed", { error: cleanupError });
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
    const { branches, branchProgresses, forks } = plan;

    if (onError === "fail-fast") {
        const firstError = await executeFailFastBranches(branches, controller, concurrency);
        mergeBranchProgresses(parentProgress, branchProgresses);
        if (firstError) {
            return { errors: [firstError], failedIndexes: [] };
        }
        mergeForkedStores(state, forks, merge);
        return { errors: [], failedIndexes: [] };
    }

    const { errors: branchErrors, successfulIndexes } = await executeContinueBranches(branches, concurrency);
    mergeBranchProgresses(parentProgress, branchProgresses);
    const successfulForks = successfulIndexes
        .map((index) => forks[index])
        .filter((fork): fork is ForkEntry => fork !== undefined);
    if (successfulForks.length > 0) {
        mergeForkedStores(state, successfulForks, merge);
    }
    return {
        errors: branchErrors.map((entry) => entry.error),
        failedIndexes: branchErrors.map((entry) => entry.index),
    };
}

// ── Container Executors ──────────────────────────────────────────────

async function executeParallel(
    node: ParallelNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    const { bus, flowName, runId } = executionContext.runtime;
    const parallelStart = Date.now();

    await bus.publish("node:parallel:start", { flowName, nodeName: node.name, runId }, { source: "system" });

    const { cleanup, controller } = createChildController(signal);
    const childPathSegments = [...executionContext.pathSegments, node.name];

    try {
        const plan: BranchPlan = { branches: [], branchProgresses: [], forks: [] };

        for (const [branchIndex, child] of node.nodes.entries()) {
            const forkedStore = state.fork(child.name);
            plan.forks.push({ label: child.name, store: forkedStore });
            const branchProgress: FlowProgress = { taskResults: [] };
            plan.branchProgresses.push(branchProgress);

            plan.branches.push(async () => {
                const meta: ParallelForkMeta = { branchIndex, branchName: child.name, nodeName: node.name };
                await withForkedProvided(
                    executionContext,
                    node.forkProvided,
                    node.cleanupProvided,
                    meta,
                    async (branchRuntime) => {
                        const branchExecutionContext: ExecutionContext = {
                            pauseGate: executionContext.pauseGate,
                            pathSegments: childPathSegments,
                            progress: branchProgress,
                            runtime: branchRuntime,
                        };
                        await executeNode(child, branchExecutionContext, forkedStore, controller.signal, iteration);
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
            await bus.publish(
                "node:parallel:end",
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
            if (node.onError === "fail-fast") {
                throw outcome.errors[0];
            }
            throw new AggregateError(
                outcome.errors,
                `${outcome.errors.length} of ${node.nodes.length} branches failed`
            );
        }

        await bus.publish(
            "node:parallel:end",
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

    const itemsContext = buildItemsContext(executionContext.runtime, state, signal, iteration);
    const items = node.items(itemsContext);

    if (!Array.isArray(items)) {
        throw new InvalidItemsError(node.name);
    }

    const everyStart = Date.now();

    await bus.publish(
        "node:every:start",
        { flowName, nodeName: node.name, runId, totalItems: items.length },
        { source: "system" }
    );

    const { cleanup, controller } = createChildController(signal);

    try {
        const plan: BranchPlan = { branches: [], branchProgresses: [], forks: [] };

        for (const [itemIndex, everyItem] of (items as unknown[]).entries()) {
            const forkedStore = state.fork(itemIndex);
            plan.forks.push({ label: itemIndex, store: forkedStore });
            const branchProgress: FlowProgress = { taskResults: [] };
            plan.branchProgresses.push(branchProgress);

            plan.branches.push(async () => {
                const meta: EveryForkMeta = { index: itemIndex, item: everyItem, nodeName: node.name };
                await withForkedProvided(
                    executionContext,
                    node.forkProvided,
                    node.cleanupProvided,
                    meta,
                    async (branchRuntime) => {
                        const branchExecutionContext: ExecutionContext = {
                            pauseGate: executionContext.pauseGate,
                            pathSegments: [...executionContext.pathSegments, node.name, String(itemIndex)],
                            progress: branchProgress,
                            runtime: branchRuntime,
                        };
                        await executeNodes(node.nodes, branchExecutionContext, forkedStore, controller.signal, {
                            index: itemIndex,
                            item: everyItem,
                        });
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
            const endPayload = {
                duration: Date.now() - everyStart,
                errors: outcome.errors,
                flowName,
                nodeName: node.name,
                runId,
                status: "failed" as const,
                totalItems: items.length,
                ...(node.onError === "continue" ? { failedIndexes: outcome.failedIndexes } : {}),
            };
            await bus.publish("node:every:end", endPayload, { source: "system" });
            if (node.onError === "fail-fast") {
                throw outcome.errors[0];
            }
            throw new AggregateError(outcome.errors, `${outcome.errors.length} of ${items.length} iterations failed`);
        }

        await bus.publish(
            "node:every:end",
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

// ── Public Entry Points ──────────────────────────────────────────────

async function executeNode(
    node: NodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    signal.throwIfAborted();

    switch (node.type) {
        case "every": {
            await executeEvery(node, executionContext, state, signal, iteration);
            break;
        }
        case "parallel": {
            await executeParallel(node, executionContext, state, signal, iteration);
            break;
        }
        case "task": {
            await executeTask(node, executionContext, state, signal, iteration);
            break;
        }
        default: {
            throw new Error(`Unknown node type: ${(node as NodeDefinition).type}`);
        }
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
