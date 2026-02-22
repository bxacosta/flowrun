import type {Reporter} from "./reporter.ts";
import type {Logger} from "./logger.ts";

export type StateShape = object;

export type MaybePromise<T> = T | Promise<T>;

export type FlowStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

export type RunCompletionStatus = Extract<FlowStatus, "completed" | "failed" | "cancelled">;

export type StepStatus = "completed" | "skipped" | "failed";

export type ErrorResolution = "fail" | "skip";

export type ParallelMode = "fail-fast" | "all-settled";

export type ParallelMergeMode = "strict" | "overwrite" | "arrays" | "custom";

export type RetryPolicyMode = "constant" | "exponential";

export type ParallelMergeResolver<TState extends StateShape = StateShape> = (
    key: keyof TState & string,
    values: Array<TState[keyof TState & string]>,
) => TState[keyof TState & string];

export interface ParallelMergeConfig<TState extends StateShape = StateShape> {
    strategy?: ParallelMergeMode;
    resolver?: ParallelMergeResolver<TState>;
}

export interface RetryPolicy {
    attempts: number;
    delayMs?: number;
    strategy?: RetryPolicyMode;
    maxDelayMs?: number;
}

export interface ErrorMeta {
    attempt: number;
    attempts: number;
}

export interface StateStore<TState extends StateShape = StateShape> {
    get<K extends keyof TState & string>(key: K): TState[K] | undefined;

    set<K extends keyof TState & string>(key: K, value: TState[K]): void;

    has<K extends keyof TState & string>(key: K): boolean;

    patch(values: Partial<TState>): void;

    snapshot(): Readonly<TState>;
}

export interface FlowInfo {
    readonly id: string;
    readonly name: string;
}

export interface StepInfo {
    readonly id: string;
    readonly name: string;
}

export interface FlowContext<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> {
    readonly flow: FlowInfo;
    readonly runId: string;
    readonly params: Readonly<TParams>;
    readonly state: StateStore<TState>;
    readonly signal: AbortSignal;
    readonly log: Logger;

    stop(reason?: string): never;
}

export interface StepContext<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> extends FlowContext<TParams, TState> {
    readonly step: StepInfo;
    readonly attempt: number;
}

export type Middleware<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> = (
    context: StepContext<TParams, TState>,
    next: () => Promise<void>,
) => MaybePromise<void>;

export type StepHandler<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> = (context: StepContext<TParams, TState>) => MaybePromise<void>;

export type ErrorResolver<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> = (
    error: Error,
    context: StepContext<TParams, TState>,
    meta: ErrorMeta,
) => MaybePromise<ErrorResolution>;

export interface StepOptions<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> {
    name?: string;
    timeoutMs?: number;
    retry?: RetryPolicy;
    onError?: ErrorResolution | ErrorResolver<TParams, TState>;
    use?: Middleware<TParams, TState>[];
}

export interface StepNode<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> extends StepOptions<TParams, TState> {
    readonly kind: "step";
    readonly id: string;
    readonly name: string;
    readonly run: StepHandler<TParams, TState>;
}

export interface SequenceNode<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> {
    readonly kind: "sequence";
    readonly id: string;
    readonly name: string;
    readonly nodes: FlowNode<TParams, TState>[];
}

export interface ParallelNode<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> {
    readonly kind: "parallel";
    readonly id: string;
    readonly name: string;
    readonly nodes: FlowNode<TParams, TState>[];
    readonly concurrency?: number;
    readonly mode: ParallelMode;
    readonly merge: ParallelMergeConfig<TState>;
}

export type FlowNode<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> =
    | StepNode<TParams, TState>
    | SequenceNode<TParams, TState>
    | ParallelNode<TParams, TState>;

export interface StepRunResult {
    readonly stepId: string;
    readonly stepName: string;
    readonly status: StepStatus;
    readonly attempts: number;
    readonly durationMs: number;
    readonly error?: Error;
}

export interface RunResult<TState extends StateShape = StateShape> {
    readonly flowId: string;
    readonly flowName: string;
    readonly runId: string;
    readonly status: RunCompletionStatus;
    readonly state: Readonly<TState>;
    readonly durationMs: number;
    readonly steps: StepRunResult[];
    readonly error?: Error;
    readonly stopReason?: string;
    readonly cancelReason?: string;
}

export interface FlowHandle<TState extends StateShape = StateShape> {
    readonly runId: string;
    readonly flowId: string;

    status(): FlowStatus;

    join(): Promise<RunResult<TState>>;

    cancel(reason?: string): Promise<void>;

    pause(): Promise<void>;

    resume(): Promise<void>;
}

export interface FlowDefinition<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> {
    readonly id: string;
    readonly name: string;
    readonly initialState?: TState | (() => TState);
    readonly middleware?: Middleware<TParams, TState>[];
    readonly steps: FlowNode<TParams, TState>[];
    readonly onStart?: (context: FlowContext<TParams, TState>) => MaybePromise<void>;
    readonly onSuccess?: (
        context: FlowContext<TParams, TState>,
        result: RunResult<TState>,
    ) => MaybePromise<void>;
    readonly onFailure?: (
        context: FlowContext<TParams, TState>,
        error: Error,
    ) => MaybePromise<void>;
    readonly onComplete?: (
        context: FlowContext<TParams, TState>,
        result: RunResult<TState>,
    ) => MaybePromise<void>;
}

export interface FlowEngineConfig {
    reporter?: Reporter;
}
