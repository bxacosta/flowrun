import type { CoreEvents } from "./events.ts";
import type { Reporter } from "./reporter.ts";

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
    values: TState[keyof TState & string][]
) => TState[keyof TState & string];

export interface ParallelMergeConfig<TState extends StateShape = StateShape> {
    resolver?: ParallelMergeResolver<TState>;
    strategy?: ParallelMergeMode;
}

export interface RetryPolicy {
    attempts: number;
    delayMs?: number;
    maxDelayMs?: number;
    strategy?: RetryPolicyMode;
}

export interface ErrorMeta {
    attempt: number;
    attempts: number;
}

export interface StateStore<TState extends StateShape = StateShape> {
    get<K extends keyof TState & string>(key: K): TState[K] | undefined;
    has<K extends keyof TState & string>(key: K): boolean;
    patch(values: Partial<TState>): void;
    set<K extends keyof TState & string>(key: K, value: TState[K]): void;
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

export interface FlowContext<TParams = Record<string, unknown>, TState extends StateShape = StateShape> {
    emit<K extends keyof CoreEvents & string>(type: K, data: CoreEvents[K]): void;
    readonly flow: FlowInfo;
    readonly params: Readonly<TParams>;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly state: StateStore<TState>;

    stop(reason?: string): never;
}

export interface StepContext<TParams = Record<string, unknown>, TState extends StateShape = StateShape>
    extends FlowContext<TParams, TState> {
    readonly attempt: number;
    readonly step: StepInfo;
}

export type Middleware<TParams = Record<string, unknown>, TState extends StateShape = StateShape> = (
    context: StepContext<TParams, TState>,
    next: () => Promise<void>
) => MaybePromise<void>;

export type StepHandler<TParams = Record<string, unknown>, TState extends StateShape = StateShape> = (
    context: StepContext<TParams, TState>
) => MaybePromise<void>;

export type ErrorResolver<TParams = Record<string, unknown>, TState extends StateShape = StateShape> = (
    error: Error,
    context: StepContext<TParams, TState>,
    meta: ErrorMeta
) => MaybePromise<ErrorResolution>;

export interface StepOptions<TParams = Record<string, unknown>, TState extends StateShape = StateShape> {
    name?: string;
    onError?: ErrorResolution | ErrorResolver<TParams, TState>;
    retry?: RetryPolicy;
    timeoutMs?: number;
    use?: Middleware<TParams, TState>[];
}

export interface StepNode<TParams = Record<string, unknown>, TState extends StateShape = StateShape>
    extends StepOptions<TParams, TState> {
    readonly id: string;
    readonly kind: "step";
    readonly name: string;
    readonly run: StepHandler<TParams, TState>;
}

export interface SequenceOptions {
    name?: string;
}

export interface SequenceNode<TParams = Record<string, unknown>, TState extends StateShape = StateShape> {
    readonly id: string;
    readonly kind: "sequence";
    readonly name: string;
    readonly nodes: FlowNode<TParams, TState>[];
}

export interface ParallelOptions<TState extends StateShape = StateShape> {
    concurrency?: number;
    merge?: ParallelMergeConfig<TState>;
    mode?: ParallelMode;
    name?: string;
}

export interface ParallelNode<TParams = Record<string, unknown>, TState extends StateShape = StateShape> {
    readonly concurrency?: number;
    readonly id: string;
    readonly kind: "parallel";
    readonly merge: ParallelMergeConfig<TState>;
    readonly mode: ParallelMode;
    readonly name: string;
    readonly nodes: FlowNode<TParams, TState>[];
}

export type FlowNode<TParams = Record<string, unknown>, TState extends StateShape = StateShape> =
    | StepNode<TParams, TState>
    | SequenceNode<TParams, TState>
    | ParallelNode<TParams, TState>;

export interface StepRunResult {
    readonly attempts: number;
    readonly durationMs: number;
    readonly error?: Error;
    readonly status: StepStatus;
    readonly stepId: string;
    readonly stepName: string;
}

export interface RunResult<TState extends StateShape = StateShape> {
    readonly cancelReason?: string;
    readonly durationMs: number;
    readonly error?: Error;
    readonly flowId: string;
    readonly flowName: string;
    readonly runId: string;
    readonly state: Readonly<TState>;
    readonly status: RunCompletionStatus;
    readonly steps: StepRunResult[];
    readonly stopReason?: string;
}

export interface FlowHandle<TState extends StateShape = StateShape> {
    cancel(reason?: string): Promise<void>;
    readonly flowId: string;
    join(): Promise<RunResult<TState>>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    readonly runId: string;

    status(): FlowStatus;
}

export interface FlowBuilder<TParams = Record<string, unknown>, TState extends StateShape = StateShape> {
    parallel(
        id: string,
        nodes: FlowNode<TParams, TState>[],
        options?: ParallelOptions<TState>
    ): ParallelNode<TParams, TState>;

    sequence(id: string, nodes: FlowNode<TParams, TState>[], options?: SequenceOptions): SequenceNode<TParams, TState>;
    step(
        id: string,
        run: StepHandler<TParams, TState>,
        options?: StepOptions<TParams, TState>
    ): StepNode<TParams, TState>;
}

export interface FlowDefinition<TParams = Record<string, unknown>, TState extends StateShape = StateShape> {
    readonly id: string;
    readonly initialState?: TState | (() => TState);
    readonly middleware?: Middleware<TParams, TState>[];
    readonly name: string;
    readonly onComplete?: (context: FlowContext<TParams, TState>, result: RunResult<TState>) => MaybePromise<void>;
    readonly onFailure?: (context: FlowContext<TParams, TState>, error: Error) => MaybePromise<void>;
    readonly onStart?: (context: FlowContext<TParams, TState>) => MaybePromise<void>;
    readonly onSuccess?: (context: FlowContext<TParams, TState>, result: RunResult<TState>) => MaybePromise<void>;
    readonly steps: FlowNode<TParams, TState>[];
}

export interface FlowDefinitionInput<TParams = Record<string, unknown>, TState extends StateShape = StateShape> {
    readonly build?: (builder: FlowBuilder<TParams, TState>) => FlowNode<TParams, TState>[];
    readonly id: string;
    readonly initialState?: TState | (() => TState);
    readonly middleware?: Middleware<TParams, TState>[];
    readonly name?: string;
    readonly onComplete?: (context: FlowContext<TParams, TState>, result: RunResult<TState>) => MaybePromise<void>;
    readonly onFailure?: (context: FlowContext<TParams, TState>, error: Error) => MaybePromise<void>;
    readonly onStart?: (context: FlowContext<TParams, TState>) => MaybePromise<void>;
    readonly onSuccess?: (context: FlowContext<TParams, TState>, result: RunResult<TState>) => MaybePromise<void>;
    readonly steps?: FlowNode<TParams, TState>[];
}

export interface FlowEngineConfig {
    reporter?: Reporter;
}
