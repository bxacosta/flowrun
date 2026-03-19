import { defaultRetryDelay, defaultRetryStrategy } from "../core/constants.ts";
import { TaskTimeoutError } from "../core/errors.ts";
import type {
    ErrorResolution,
    Middleware,
    MiddlewareNext,
    StateShape,
    TaskDefinition,
    UserEmitEventMap,
    UserEventMap,
} from "../core/types.ts";
import { createLinkedAbortController } from "../utils/abort.ts";
import { waitForDelay } from "../utils/delay.ts";
import { composeMiddleware, mergeMiddleware } from "../utils/middleware.ts";
import { getDurationMs } from "../utils/time.ts";
import { createTaskContext } from "./context-factory.ts";
import type { ExecutionContext, TaskExecutionOutcome } from "./execution-types.ts";

const normalizeError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

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

        void execute()
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

const resolveTaskError = async <
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
>(
    error: Error,
    context: ExecutionContext<TParams, TState, TUserEvents, TBaseContext>,
    task: TaskDefinition<TParams, TState, TUserEvents, TBaseContext, object>,
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

    const taskContext = createTaskContext(
        {
            emit: <TType extends keyof UserEmitEventMap<TUserEvents> & string>(
                type: TType,
                data: UserEmitEventMap<TUserEvents>[TType]
            ) => {
                context.emitUserEvent(type, data);
            },
            flow: context.flowInfo,
            params: context.params,
            runId: context.runId,
            signal: attemptSignal,
            state: context.stateStore,
            stop: (reason) => context.runController.requestStop(reason),
            userContext: context.scopedContext,
        },
        { id: task.id, name: task.name },
        attempt
    );

    try {
        return await (task.onError as Exclude<typeof task.onError, ErrorResolution>)(error, taskContext as any, {
            attempt,
            attempts,
        });
    } catch {
        return "fail";
    }
};

export const executeTask = async <
    TParams,
    TState extends StateShape,
    TUserEvents extends UserEventMap,
    TBaseContext extends object,
>(
    context: ExecutionContext<TParams, TState, TUserEvents, TBaseContext>,
    task: TaskDefinition<TParams, TState, TUserEvents, TBaseContext, object>
): Promise<TaskExecutionOutcome> => {
    const attempts = task.retry?.attempts ?? 1;
    let totalDurationMs = 0;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const attemptStart = performance.now();
        const attemptAbortController = createLinkedAbortController(context.signal);

        try {
            const taskContext = createTaskContext(
                {
                    emit: <TType extends keyof UserEmitEventMap<TUserEvents> & string>(
                        type: TType,
                        data: UserEmitEventMap<TUserEvents>[TType]
                    ) => {
                        context.emitUserEvent(type, data);
                    },
                    flow: context.flowInfo,
                    params: context.params,
                    runId: context.runId,
                    signal: attemptAbortController.signal,
                    state: context.stateStore,
                    stop: (reason) => context.runController.requestStop(reason),
                    userContext: context.scopedContext,
                },
                { id: task.id, name: task.name },
                attempt
            );

            context.eventBus.dispatch({
                flowId: context.flowInfo.id,
                payload: { attempt, attempts, taskId: task.id, taskName: task.name },
                runId: context.runId,
                type: "task.started",
            });

            // Merge flow-level and task-level middleware, compose with handler
            const pipeline = composeMiddleware<any>(
                mergeMiddleware<any, any, any, any>(
                    context.flowMiddleware as readonly Middleware<any, any, any, any>[],
                    task.middleware as readonly Middleware<any, any, any, any>[]
                ) as readonly ((context: any, next: MiddlewareNext) => void | Promise<void>)[],
                async (ctx) => {
                    await task.handler(ctx);
                }
            );

            await runWithTimeout(
                async () => {
                    await pipeline(taskContext);
                },
                task.timeoutMs,
                attemptAbortController,
                task.id
            );

            totalDurationMs += getDurationMs(attemptStart);

            context.eventBus.dispatch({
                flowId: context.flowInfo.id,
                payload: {
                    attempt,
                    attempts,
                    durationMs: totalDurationMs,
                    status: "completed",
                    taskId: task.id,
                    taskName: task.name,
                },
                runId: context.runId,
                type: "task.ended",
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
                context.eventBus.dispatch({
                    flowId: context.flowInfo.id,
                    payload: {
                        attempt,
                        attempts,
                        durationMs: totalDurationMs,
                        status: "completed",
                        taskId: task.id,
                        taskName: task.name,
                    },
                    runId: context.runId,
                    type: "task.ended",
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

                context.eventBus.dispatch({
                    flowId: context.flowInfo.id,
                    payload: {
                        attempt,
                        attempts,
                        durationMs: totalDurationMs,
                        error: taskError,
                        status: "failed",
                        taskId: task.id,
                        taskName: task.name,
                    },
                    runId: context.runId,
                    type: "task.ended",
                });

                context.eventBus.dispatch({
                    flowId: context.flowInfo.id,
                    payload: {
                        attempt,
                        attempts,
                        delayMs,
                        error: taskError,
                        taskId: task.id,
                        taskName: task.name,
                    },
                    runId: context.runId,
                    type: "task.retrying",
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

            context.eventBus.dispatch({
                flowId: context.flowInfo.id,
                payload: {
                    attempt,
                    attempts,
                    durationMs: totalDurationMs,
                    error: taskError,
                    status,
                    taskId: task.id,
                    taskName: task.name,
                },
                runId: context.runId,
                type: "task.ended",
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
