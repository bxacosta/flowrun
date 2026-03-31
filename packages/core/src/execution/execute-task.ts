import { defaultRetryDelay, defaultRetryStrategy } from "../core/constants.ts";
import { TaskTimeoutError } from "../core/errors.ts";
import type { AnyTaskDefinition, ErrorResolution } from "../core/types.ts";
import { createLinkedAbortController } from "../utils/abort.ts";
import { waitForDelay } from "../utils/delay.ts";
import { normalizeError } from "../utils/errors.ts";
import { composeMiddleware } from "../utils/middleware.ts";
import { getDurationMs } from "../utils/time.ts";
import { createTaskContext } from "./context-factory.ts";
import { dispatchEvent } from "./dispatch.ts";
import type { ExecutionContext, TaskExecutionOutcome } from "./execution-types.ts";

const getRetryDelay = (
    attempt: number,
    retry: { delayMs?: number; maxDelayMs?: number; strategy?: string } | undefined
): number => {
    const delayMs = retry?.delayMs ?? defaultRetryDelay;

    if (retry?.strategy === undefined || retry.strategy === defaultRetryStrategy) {
        return delayMs;
    }

    const exponentialDelay = delayMs * 2 ** (attempt - 1);

    if (retry.maxDelayMs === undefined) {
        return exponentialDelay;
    }

    return Math.min(exponentialDelay, retry.maxDelayMs);
};

const runWithTimeout = async (
    execute: () => Promise<void>,
    timeoutMs: number | undefined,
    abortController: AbortController,
    taskId: string
): Promise<void> => {
    if (timeoutMs === undefined) {
        await execute();
        return;
    }

    await new Promise<void>((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            abortController.abort();
            reject(new TaskTimeoutError(taskId, timeoutMs));
        }, timeoutMs);

        execute()
            .then(() => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timeout);
                resolve();
            })
            .catch((error: unknown) => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timeout);
                reject(error);
            });
    });
};

const makeTaskContext = (context: ExecutionContext, task: AnyTaskDefinition, attempt: number, signal: AbortSignal) =>
    createTaskContext(
        {
            emit: (type, data) => context.emitUserEvent(type, data),
            flow: context.flowInfo,
            params: context.params,
            runId: context.runId,
            signal,
            state: context.stateStore,
            stop: (reason) => context.runController.requestStop(reason),
            userContext: context.scopedContext,
        },
        { id: task.id, name: task.name },
        attempt
    );

const dispatchTaskEvent = (context: ExecutionContext, type: string, payload: object): void => {
    dispatchEvent(context.eventBus, context.flowInfo.id, context.runId, type, payload);
};

const resolveTaskError = async (
    error: Error,
    context: ExecutionContext,
    task: AnyTaskDefinition,
    attempt: number,
    attempts: number,
    attemptSignal: AbortSignal
): Promise<ErrorResolution> => {
    if (task.onError === undefined) {
        return "fail";
    }

    if (task.onError === "fail" || task.onError === "skip") {
        return task.onError;
    }

    const taskContext = makeTaskContext(context, task, attempt, attemptSignal);

    try {
        return await (task.onError as Exclude<typeof task.onError, ErrorResolution>)(error, taskContext, {
            attempt,
            attempts,
        });
    } catch {
        return "fail";
    }
};

export const executeTask = async (
    context: ExecutionContext,
    task: AnyTaskDefinition
): Promise<TaskExecutionOutcome> => {
    const attempts = task.retry?.attempts ?? 1;
    let totalDurationMs = 0;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const attemptStart = performance.now();
        const attemptAbortController = createLinkedAbortController(context.signal);

        try {
            const taskContext = makeTaskContext(context, task, attempt, attemptAbortController.signal);

            dispatchTaskEvent(context, "task.started", {
                attempt,
                attempts,
                taskId: task.id,
                taskName: task.name,
            });

            const allMiddleware = [...context.flowMiddleware, ...task.middleware];

            const pipeline = composeMiddleware(allMiddleware, async (context) => {
                await task.handler(context);
            });

            await runWithTimeout(
                async () => {
                    await pipeline(taskContext);
                },
                task.timeoutMs,
                attemptAbortController,
                task.id
            );

            totalDurationMs += getDurationMs(attemptStart);

            dispatchTaskEvent(context, "task.ended", {
                attempt,
                attempts,
                durationMs: totalDurationMs,
                status: "completed",
                taskId: task.id,
                taskName: task.name,
            });

            context.taskResults.push({
                attempts: attempt,
                durationMs: totalDurationMs,
                status: "completed",
                taskId: task.id,
                taskName: task.name,
            });

            return {
                status: "completed",
                stopReason: context.runController.stopReason,
            };
        } catch (error) {
            const taskError = normalizeError(error);
            totalDurationMs += getDurationMs(attemptStart);

            if (taskError.name === "StopFlowError") {
                dispatchTaskEvent(context, "task.ended", {
                    attempt,
                    attempts,
                    durationMs: totalDurationMs,
                    status: "completed",
                    taskId: task.id,
                    taskName: task.name,
                });

                context.taskResults.push({
                    attempts: attempt,
                    durationMs: totalDurationMs,
                    status: "completed",
                    taskId: task.id,
                    taskName: task.name,
                });

                return {
                    status: "completed",
                    stopReason: context.runController.stopReason,
                };
            }

            const canRetry =
                attempt < attempts &&
                !context.signal.aborted &&
                !context.runController.isStopped &&
                !context.runController.isCancelled;

            if (canRetry) {
                const delayMs = getRetryDelay(attempt, task.retry);

                dispatchTaskEvent(context, "task.ended", {
                    attempt,
                    attempts,
                    durationMs: totalDurationMs,
                    error: taskError,
                    status: "failed",
                    taskId: task.id,
                    taskName: task.name,
                });

                dispatchTaskEvent(context, "task.retrying", {
                    attempt,
                    attempts,
                    delayMs,
                    error: taskError,
                    taskId: task.id,
                    taskName: task.name,
                });

                await waitForDelay(delayMs, context.signal);
                continue;
            }

            const resolution = await resolveTaskError(
                taskError,
                context,
                task,
                attempt,
                attempts,
                attemptAbortController.signal
            );

            const status = resolution === "skip" ? ("skipped" as const) : ("failed" as const);

            dispatchTaskEvent(context, "task.ended", {
                attempt,
                attempts,
                durationMs: totalDurationMs,
                error: taskError,
                status,
                taskId: task.id,
                taskName: task.name,
            });

            context.taskResults.push({
                attempts,
                durationMs: totalDurationMs,
                error: taskError,
                status,
                taskId: task.id,
                taskName: task.name,
            });

            return { error: taskError, status };
        }
    }

    return {
        error: new Error(`Task "${task.id}" exhausted all retry attempts`),
        status: "failed",
    };
};
