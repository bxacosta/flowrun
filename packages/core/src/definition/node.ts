/**
 * definition/node.ts — Node definitions
 *
 * Layer: L3 (definition). The declarative node tree (task/parallel/each), retry
 * and error policy, container resource lifecycle, and the type-erased callback
 * aliases the runtime invokes. Run results live in engine/results.ts.
 */

import type { MaybePromise } from "../core/types.ts";
import type { Shape } from "../shape/shape.ts";
import type { MergeStrategy } from "../state/types.ts";
import type { AnyMiddleware } from "./middleware.ts";

// ── Policies ────────────────────────────────────────────────────────

export type ErrorMode = "fail" | "ignore";

interface RetryBase {
    delayMs: number;
    jitter?: boolean;
    maxAttempts: number;
    maxDelayMs?: number;
    retryOn?: (error: Error, attempt: number) => boolean;
}

export type RetryConfig = RetryBase & ({ backoff: "constant" } | { backoff: "exponential"; factor?: number });

export interface ResourceOutcome {
    error?: Error;
    status: "failed" | "success";
}

// ── Container meta ──────────────────────────────────────────────────

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

export interface ContainerResource {
    cleanup?: AnyCleanup;
    provide: AnyProvide;
}

// ── Node definitions ────────────────────────────────────────────────

export interface TaskNodeDefinition {
    middleware: AnyMiddleware[];
    name: string;
    onError: ErrorMode;
    retry?: RetryConfig;
    run: AnyTaskRunner;
    type: "task";
}

export interface ParallelNodeDefinition {
    merge: MergeStrategy;
    name: string;
    nodes: NodeDefinition[];
    onError: ErrorMode;
    resource?: ContainerResource;
    type: "parallel";
}

export interface EachNodeDefinition {
    concurrency: number;
    items: AnyItemsFunction;
    merge: MergeStrategy;
    name: string;
    nodes: NodeDefinition[];
    onError: ErrorMode;
    resource?: ContainerResource;
    type: "each";
}

export type NodeDefinition = EachNodeDefinition | ParallelNodeDefinition | TaskNodeDefinition;

export type Node<TShape extends Shape = Shape> = NodeDefinition & {
    readonly _shape?: TShape;
};

// ── Type-erased callback boundaries ─────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: type-erased task runner, typed at definition boundary
export type AnyTaskRunner = (context: any) => MaybePromise<void>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased provide callback, typed at definition boundary
export type AnyProvide = (context: any, meta: any) => MaybePromise<object>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased cleanup callback, typed at definition boundary
export type AnyCleanup = (context: any, meta: any, outcome: ResourceOutcome) => MaybePromise<void>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased items callback, typed at definition boundary
export type AnyItemsFunction = (context: any) => MaybePromise<readonly unknown[]>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased state factory, typed at definition boundary
export type AnyStateFactory = (params: any) => object;
