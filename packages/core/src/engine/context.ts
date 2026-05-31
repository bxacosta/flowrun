/**
 * engine/context.ts — Runtime context construction
 *
 * Layer: L4 (engine). Builds the concrete context objects (flow/container/task)
 * handed to user code, wiring the scoped emit, logger and request opener.
 */

import type { PauseGate } from "../core/async.ts";
import { SkipSignal } from "../core/signals.ts";
import type { ContextRequest, RequestDefinition, RequestOptions } from "../definition/request.ts";
import { type AnyEventBus, createEmitMeta, type EmitMeta } from "../events/bus.ts";
import { createLogger, type Logger } from "../events/logger.ts";
import type { EmitFn, EmitOptions, EventSource } from "../events/types.ts";
import type { AnyFlowStateStore } from "../state/types.ts";
import type { RequestManager } from "./request-manager.ts";
import type { TaskResult } from "./results.ts";

// ── Runtime types ───────────────────────────────────────────────────

export interface FlowRuntime {
    bus: AnyEventBus;
    flowName: string;
    log: Logger;
    params: Readonly<Record<string, unknown>>;
    provided: Record<string, unknown>;
    requests: RequestManager;
    runId: string;
}

export interface FlowProgress {
    taskResults: TaskResult[];
}

export interface RequestRuntimeMeta {
    attempt?: number;
    iteration?: { index: number; item: unknown };
    nodeName?: string;
    path: readonly string[];
}

export interface ExecutionContext {
    pathSegments: readonly string[];
    pauseGate: PauseGate;
    progress: FlowProgress;
    runtime: FlowRuntime;
}

interface ScopeLocation {
    iteration?: { index: number; item: unknown };
    nodeName?: string;
    path?: readonly string[];
}

// ── Scoping helpers ─────────────────────────────────────────────────

export function flowSource(flowName: string): EventSource {
    return `flow:${flowName}`;
}

function buildEmitMeta(runtime: FlowRuntime, location: ScopeLocation, correlationId?: string): EmitMeta {
    return createEmitMeta(flowSource(runtime.flowName), runtime, { ...location, correlationId });
}

function buildScopeEmitter(runtime: FlowRuntime, location: ScopeLocation): EmitFn<Record<string, unknown>> {
    const emit = (topic: string, payload?: unknown, options?: EmitOptions): void => {
        runtime.bus.emit(topic, payload, buildEmitMeta(runtime, location, options?.correlationId));
    };
    return emit as unknown as EmitFn<Record<string, unknown>>;
}

function buildScopeLogger(runtime: FlowRuntime, location: ScopeLocation): Logger {
    return createLogger({
        bus: runtime.bus,
        flowName: runtime.flowName,
        iteration: location.iteration,
        nodeName: location.nodeName,
        path: location.path,
        runId: runtime.runId,
        source: flowSource(runtime.flowName),
    });
}

function createContextRequest(runtime: FlowRuntime, signal: AbortSignal, meta: RequestRuntimeMeta): ContextRequest {
    return <TPayload, TResponse>(
        definition: RequestDefinition<TPayload, TResponse>,
        payload: TPayload,
        options?: RequestOptions
    ) =>
        runtime.requests.open({
            attempt: meta.attempt,
            definition,
            flowName: runtime.flowName,
            iteration: meta.iteration,
            nodeName: meta.nodeName,
            options,
            path: meta.path,
            payload,
            runId: runtime.runId,
            signal,
        });
}

// ── Context builders ────────────────────────────────────────────────

function buildBaseContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    location: ScopeLocation,
    requestMeta: RequestRuntimeMeta
): Record<string, unknown> {
    return {
        ...runtime.provided,
        emit: buildScopeEmitter(runtime, location),
        flowName: runtime.flowName,
        log: buildScopeLogger(runtime, location),
        params: runtime.params,
        request: createContextRequest(runtime, signal, requestMeta),
        runId: runtime.runId,
        signal,
        state,
    };
}

export function buildFlowContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal
): Record<string, unknown> {
    return buildBaseContext(runtime, state, signal, {}, { path: [] });
}

export function buildContainerContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    pathSegments: readonly string[],
    iteration?: { index: number; item: unknown }
): Record<string, unknown> {
    const context = buildBaseContext(
        runtime,
        state,
        signal,
        { iteration, path: pathSegments },
        { iteration, path: pathSegments }
    );
    if (!iteration) {
        return context;
    }
    return {
        ...context,
        iteration: Object.freeze({ index: iteration.index, item: iteration.item }),
    };
}

export function buildTaskContext(
    runtime: FlowRuntime,
    state: AnyFlowStateStore,
    signal: AbortSignal,
    pathSegments: readonly string[],
    nodeName: string,
    attempt: number,
    iteration?: { index: number; item: unknown }
): Record<string, unknown> {
    const location: ScopeLocation = { iteration, nodeName, path: pathSegments };
    const requestMeta: RequestRuntimeMeta = { attempt, iteration, nodeName, path: pathSegments };
    const context: Record<string, unknown> = {
        ...buildBaseContext(runtime, state, signal, location, requestMeta),
        attempt,
        nodeName,
        skip: (reason?: string) => {
            throw new SkipSignal(reason);
        },
    };

    if (!iteration) {
        return context;
    }

    return {
        ...context,
        iteration: Object.freeze({ index: iteration.index, item: iteration.item }),
    };
}
