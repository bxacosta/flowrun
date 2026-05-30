import type { AnyMiddleware } from "./middleware.ts";
import type { Shape } from "./shape.ts";
import type { MergeStrategy } from "./state.ts";
import type { MaybePromise } from "./utils.ts";

export type ErrorMode = "fail" | "ignore";

interface RetryBase {
    delayMs: number;
    jitter?: boolean;
    maxAttempts: number;
    maxDelayMs?: number;
    retryOn?: (error: Error, attempt: number) => boolean;
}

export type RetryConfig = RetryBase & ({ backoff: "constant" } | { backoff: "exponential"; factor?: number });

export interface ParallelMeta {
    branchIndex: number;
    branchName: string;
    nodeName: string;
}

export interface EachMeta<TItem = unknown> {
    index: number;
    item: TItem;
    nodeName: string;
}

export interface TaskNodeDefinition {
    middleware: AnyMiddleware[];
    name: string;
    onError: ErrorMode;
    retry?: RetryConfig;
    run: AnyTaskRunner;
    type: "task";
}

export interface ContainerResource {
    cleanup?: AnyCleanup;
    provide: AnyProvide;
}

export interface ParallelNodeDefinition {
    merge: MergeStrategy;
    name: string;
    nodes: NodeDefinition[];
    onBranchError: ErrorMode;
    resource?: ContainerResource;
    type: "parallel";
}

export interface EachNodeDefinition {
    concurrency: number;
    items: AnyItemsFunction;
    merge: MergeStrategy;
    name: string;
    nodes: NodeDefinition[];
    onBranchError: ErrorMode;
    resource?: ContainerResource;
    type: "each";
}

export type NodeDefinition = EachNodeDefinition | ParallelNodeDefinition | TaskNodeDefinition;

export type Node<TShape extends Shape = Shape> = NodeDefinition & {
    readonly _shape?: TShape;
};

export interface TaskResult {
    attempts: number;
    durationMs: number;
    error?: Error;
    ignored: boolean;
    iteration?: { index: number; item: unknown };
    nodeName: string;
    path: string;
    reason?: string;
    status: "failed" | "skipped" | "success";
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased task runner, typed at definition boundary
export type AnyTaskRunner = (context: any) => MaybePromise<void>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased provide callback, typed at definition boundary
export type AnyProvide = (context: any, meta: any) => MaybePromise<object>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased cleanup callback, typed at definition boundary
export type AnyCleanup = (context: any, meta: any) => MaybePromise<void>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased items callback, typed at definition boundary
export type AnyItemsFunction = (context: any) => MaybePromise<readonly unknown[]>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased state factory, typed at definition boundary
export type AnyStateFactory = (params: any) => object;
