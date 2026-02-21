export type StateShape = object;

export type MaybePromise<T> = T | Promise<T>;

export type ErrorResolution = "fail" | "skip";

export type ParallelMode = "fail-fast" | "all-settled";

export type RetryPolicyMode = "constant" | "exponential";


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
}

export type FlowNode<
    TParams = Record<string, unknown>,
    TState extends StateShape = StateShape,
> =
    | StepNode<TParams, TState>
    | SequenceNode<TParams, TState>
    | ParallelNode<TParams, TState>;