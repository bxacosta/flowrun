/**
 * engine/execute.ts — Node execution
 *
 * Layer: L4 (engine). Walks the node tree: task attempt/retry loop, parallel and
 * each fan-out with forked state, branch error policy, and container resources.
 */

import {
    createChildController,
    executeContinueBranches,
    executeFailFastBranches,
    sleepWithSignal,
} from "../core/async.ts";
import { FlowEngineError, normalizeError } from "../core/errors.ts";
import { SkipSignal } from "../core/signals.ts";
import { assertPlainObject } from "../core/validation.ts";
import type {
    AnyCleanup,
    AnyProvide,
    EachMeta,
    EachNodeDefinition,
    ErrorMode,
    NodeDefinition,
    ParallelMeta,
    ParallelNodeDefinition,
    ResourceOutcome,
    RetryConfig,
    TaskNodeDefinition,
} from "../definition/node.ts";
import { createEmitMeta, type EmitMeta } from "../events/bus.ts";
import { type ForkEntry, mergeForkedStores } from "../state/store.ts";
import type { AnyFlowStateStore, MergeStrategy } from "../state/types.ts";
import { compose } from "./compose.ts";
import {
    buildContainerContext,
    buildTaskContext,
    type ExecutionContext,
    type FlowProgress,
    type FlowRuntime,
} from "./context.ts";
import type { TaskResult } from "./results.ts";

// ── Errors ──────────────────────────────────────────────────────────

export class InvalidItemsError extends FlowEngineError {
    override readonly name = "InvalidItemsError";

    constructor(nodeName: string) {
        super(`Node "${nodeName}": items must return an array`);
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

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
    durationMs: number,
    status: "failed" | "skipped" | "success",
    ignored: boolean,
    error: Error | null,
    reason: string | undefined,
    iteration?: { index: number; item: unknown }
): void {
    const result: TaskResult = {
        attempts,
        durationMs,
        ignored,
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

// ── Task ────────────────────────────────────────────────────────────

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
    const maxAttempts = node.retry?.maxAttempts ?? 1;
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
        bus.emit("node:task:ended", { attempts, durationMs, ignored: false, status: "success" }, meta);
        recordTaskResult(
            executionContext.progress,
            node,
            path,
            attempts,
            durationMs,
            "success",
            false,
            null,
            undefined,
            iteration
        );
        return;
    }

    if (outcome.status === "skipped") {
        bus.emit(
            "node:task:ended",
            { attempts, durationMs, ignored: false, reason: outcome.reason, status: "skipped" },
            meta
        );
        recordTaskResult(
            executionContext.progress,
            node,
            path,
            attempts,
            durationMs,
            "skipped",
            false,
            null,
            outcome.reason,
            iteration
        );
        return;
    }

    if (!signal.aborted && node.onError === "ignore") {
        bus.emit(
            "node:task:ended",
            { attempts, durationMs, error: outcome.error, ignored: true, status: "failed" },
            meta
        );
        recordTaskResult(
            executionContext.progress,
            node,
            path,
            attempts,
            durationMs,
            "failed",
            true,
            outcome.error,
            undefined,
            iteration
        );
        return;
    }

    bus.emit("node:task:ended", { attempts, durationMs, error: outcome.error, ignored: false, status: "failed" }, meta);
    recordTaskResult(
        executionContext.progress,
        node,
        path,
        attempts,
        durationMs,
        "failed",
        false,
        outcome.error,
        undefined,
        iteration
    );
    throw outcome.error;
}

// ── Branch planning & containers ────────────────────────────────────

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
        const provideContext = buildContainerContext(branchRuntime, state, signal, branchPathSegments, iteration);
        const localProvided = await provide(provideContext, meta);
        assertPlainObject(localProvided, "Container provide() must return a plain object");
        branchRuntime = {
            ...branchRuntime,
            provided: { ...branchRuntime.provided, ...localProvided },
        };
    }

    let outcome: ResourceOutcome = { status: "success" };
    try {
        await execute(branchRuntime);
    } catch (error) {
        outcome = { error: normalizeError(error), status: "failed" };
        throw error;
    } finally {
        if (cleanup) {
            try {
                const cleanupContext = buildContainerContext(
                    branchRuntime,
                    state,
                    signal,
                    branchPathSegments,
                    iteration
                );
                await cleanup(cleanupContext, meta, outcome);
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
    onError: ErrorMode,
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
        } else if (node.onError === "ignore") {
            bus.emit("node:parallel:ended", { durationMs, errors: outcome.errors, status: "success" }, meta);
        } else {
            bus.emit("node:parallel:ended", { durationMs, errors: outcome.errors, status: "failed" }, meta);
            throw outcome.errors[0];
        }
    } finally {
        cleanup();
    }
}

async function executeEach(
    node: EachNodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    const { runtime } = executionContext;
    const { bus } = runtime;
    const containerPathSegments = [...executionContext.pathSegments, node.name];
    const meta = runtimeMeta(runtime, { iteration, nodeName: node.name, path: containerPathSegments });

    const itemsContext = buildContainerContext(runtime, state, signal, containerPathSegments, iteration);
    const items = await node.items(itemsContext);

    if (!Array.isArray(items)) {
        throw new InvalidItemsError(node.name);
    }

    const eachStart = Date.now();
    bus.emit("node:each:started", { totalItems: items.length }, meta);

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
                const branchMeta: EachMeta = { index: itemIndex, item, nodeName: node.name };
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

        const durationMs = Date.now() - eachStart;

        if (outcome.errors.length === 0) {
            bus.emit("node:each:ended", { durationMs, status: "success", totalItems: items.length }, meta);
        } else if (node.onError === "ignore") {
            bus.emit(
                "node:each:ended",
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
                "node:each:ended",
                { durationMs, errors: outcome.errors, status: "failed", totalItems: items.length },
                meta
            );
            throw outcome.errors[0];
        }
    } finally {
        cleanup();
    }
}

// ── Dispatch ────────────────────────────────────────────────────────

async function executeNode(
    node: NodeDefinition,
    executionContext: ExecutionContext,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    iteration?: { index: number; item: unknown }
): Promise<void> {
    signal.throwIfAborted();

    switch (node.type) {
        case "each":
            await executeEach(node, executionContext, state, signal, iteration);
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
