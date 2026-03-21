import { isDeepStrictEqual } from "node:util";
import { ParallelMergeError } from "../core/errors.ts";
import type { MergeResolver, MergeStrategy, ParallelBranchInfo, StateShape, TaskRunResult } from "../core/types.ts";
import type { FlowStateStore } from "../state/state-store.ts";
import { createCompositeAbortController } from "../utils/abort.ts";
import { cloneValue } from "../utils/clone.ts";
import { createFlowContext } from "./context-factory.ts";
import { executeNodes } from "./execute-nodes.ts";
import type { ExecutionContext, NodeExecutionOutcome } from "./execution-types.ts";
import type { ResolvedNode, ResolvedParallelNode } from "./resolver.ts";

interface BranchResult {
    readonly error?: Error;
    readonly index: number;
    readonly stateStore: FlowStateStore<StateShape>;
    readonly stopReason?: string;
    readonly taskResults: readonly TaskRunResult[];
}

const normalizeError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const mergeBranchStates = (
    parentState: FlowStateStore<StateShape>,
    branches: readonly BranchResult[],
    merge: MergeStrategy<StateShape>
): void => {
    const valuesByKey = new Map<string, { index: number; value: unknown }[]>();

    for (const branch of branches) {
        const writtenValues = branch.stateStore.getWrittenValues();

        for (const [key, value] of writtenValues.entries()) {
            const entries = valuesByKey.get(key as string) ?? [];
            entries.push({ index: branch.index, value });
            valuesByKey.set(key as string, entries);
        }
    }

    for (const [key, values] of valuesByKey) {
        const ordered = values.sort((a, b) => a.index - b.index);
        const first = ordered[0];

        if (ordered.length === 0 || first === undefined) {
            continue;
        }

        if (ordered.length === 1) {
            parentState.set(key, first.value);
            continue;
        }

        if (merge === "overwrite") {
            const last = ordered[ordered.length - 1];

            if (last !== undefined) {
                parentState.set(key, last.value);
            }

            continue;
        }

        if (merge === "arrays") {
            if (!ordered.every((entry) => Array.isArray(entry.value))) {
                throw new ParallelMergeError(
                    String(key),
                    `Parallel merge strategy "arrays" requires all values for "${String(key)}" to be arrays`
                );
            }

            const merged = ordered.flatMap((entry) => entry.value as unknown[]);
            parentState.set(key, cloneValue(merged));
            continue;
        }

        if (merge === "strict") {
            if (!ordered.every((entry) => isDeepStrictEqual(entry.value, first.value))) {
                throw new ParallelMergeError(String(key));
            }

            parentState.set(key, first.value);
            continue;
        }

        const resolver = merge as MergeResolver<StateShape>;
        const resolved = resolver(
            key,
            ordered.map((entry) => entry.value)
        );
        parentState.set(key, resolved);
    }
};

export const executeParallel = async (
    context: ExecutionContext,
    node: ResolvedParallelNode
): Promise<NodeExecutionOutcome> => {
    const limit = node.definition.concurrency ?? node.branches.length;
    const activeBranches = new Set<Promise<void>>();
    const branchResults: BranchResult[] = [];
    const groupAbortController = new AbortController();
    let fatalError: Error | undefined;
    let nextIndex = 0;
    let stopReason: string | undefined;

    const runBranch = async (branchNodes: readonly ResolvedNode[], index: number): Promise<void> => {
        const branchDefinition = node.definition.children[index];

        if (branchDefinition === undefined) {
            throw new Error(`Parallel branch ${String(index)} is missing definition`);
        }

        const meta: ParallelBranchInfo = {
            branchId: branchDefinition.id,
            branchName: branchDefinition.name,
            groupId: node.definition.id,
            groupName: node.definition.name,
            index,
        };

        const branchState = context.stateStore.fork();
        const branchTaskResults: TaskRunResult[] = [];
        const branchSignal = createCompositeAbortController([context.signal, groupAbortController.signal]);

        // Build a flow-level context for forkContext/cleanupContext callbacks
        const flowCtx = createFlowContext({
            emit: (type, data) => context.emitUserEvent(type, data),
            flow: context.flowInfo,
            params: context.params,
            runId: context.runId,
            signal: branchSignal.signal,
            state: branchState,
            stop: (reason) => context.runController.requestStop(reason),
            userContext: context.scopedContext,
        });

        const branchScopedContext =
            node.definition.forkContext !== undefined
                ? await (node.definition.forkContext as any)(flowCtx, meta)
                : context.scopedContext;

        let branchResult: BranchResult = {
            index,
            stateStore: branchState,
            taskResults: branchTaskResults,
        };

        try {
            const outcome = await executeNodes(
                {
                    ...context,
                    scopedContext: branchScopedContext,
                    signal: branchSignal.signal,
                    stateStore: branchState,
                    taskResults: branchTaskResults,
                },
                branchNodes
            );

            branchResult = {
                ...branchResult,
                error: outcome.error,
                stopReason: outcome.stopReason,
            };

            if (outcome.stopReason !== undefined && stopReason === undefined) {
                stopReason = outcome.stopReason;
            }

            if (outcome.error !== undefined && node.definition.mode === "fail-fast" && fatalError === undefined) {
                fatalError = outcome.error;
                groupAbortController.abort(outcome.error);
            }
        } catch (error) {
            const branchError = normalizeError(error);

            branchResult = {
                ...branchResult,
                error: branchError,
            };

            if (node.definition.mode === "fail-fast" && fatalError === undefined) {
                fatalError = branchError;
                groupAbortController.abort(branchError);
            }
        } finally {
            branchResults.push(branchResult);

            if (node.definition.cleanupContext !== undefined) {
                try {
                    // Pass the forked flow context for cleanup
                    const cleanupCtx = createFlowContext({
                        emit: (type, data) => context.emitUserEvent(type, data),
                        flow: context.flowInfo,
                        params: context.params,
                        runId: context.runId,
                        signal: branchSignal.signal,
                        state: branchState,
                        stop: (reason) => context.runController.requestStop(reason),
                        userContext: branchScopedContext,
                    });
                    await (node.definition.cleanupContext as any)(cleanupCtx, meta);
                } catch {
                    // Cleanup failures are silently ignored
                }
            }
        }
    };

    const launchNext = (): void => {
        while (
            nextIndex < node.branches.length &&
            activeBranches.size < limit &&
            !context.runController.isCancelled &&
            !context.runController.isStopped &&
            stopReason === undefined &&
            (node.definition.mode === "all-settled" || fatalError === undefined)
        ) {
            const branchIndex = nextIndex;
            nextIndex += 1;
            const branchNodes = node.branches[branchIndex];

            if (branchNodes === undefined) {
                continue;
            }

            let branchPromise: Promise<void>;
            branchPromise = runBranch(branchNodes, branchIndex).finally(() => {
                activeBranches.delete(branchPromise);
            });
            activeBranches.add(branchPromise);
        }
    };

    launchNext();

    while (activeBranches.size > 0) {
        await Promise.race(activeBranches);
        launchNext();
    }

    const orderedResults = branchResults.slice().sort((a, b) => a.index - b.index);

    for (const result of orderedResults) {
        context.taskResults.push(...result.taskResults);
    }

    if (fatalError !== undefined) {
        return { error: fatalError };
    }

    if (stopReason !== undefined) {
        try {
            mergeBranchStates(
                context.stateStore,
                orderedResults.filter((r) => r.error === undefined),
                node.definition.merge
            );
        } catch (error) {
            return { error: normalizeError(error) };
        }

        return { stopReason };
    }

    const failedBranches = orderedResults.filter((r) => r.error !== undefined).map((r) => r.error as Error);

    if (failedBranches.length > 0) {
        if (node.definition.mode === "all-settled") {
            return {
                error: new AggregateError(failedBranches, `Parallel group "${node.definition.id}" failed`),
            };
        }

        return { error: failedBranches[0] };
    }

    try {
        mergeBranchStates(context.stateStore, orderedResults, node.definition.merge);
    } catch (error) {
        return { error: normalizeError(error) };
    }

    return {};
};
