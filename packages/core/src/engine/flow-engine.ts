import { randomUUID } from "node:crypto";
import { FlowEngineError } from "../core/errors.ts";
import type {
    AnyExtension,
    AnyFlowDefinition,
    EmptyEventMap,
    EngineEventMap,
    EventSubscriberApi,
    Extension,
    FlowDefinition,
    FlowEngineOptions,
    FlowHandle,
    ParamsOf,
    RunResult,
    StateOf,
    StateShape,
    TaskContext,
} from "../core/types.ts";
import { defineFlow, type FlowInput } from "../definitions/define-flow.ts";
import { EventBus } from "../events/event-bus.ts";
import { executeFlow } from "../execution/execute-flow.ts";
import { resolveFlow } from "../execution/resolver.ts";
import type { ObjectRecord, Simplify } from "../utils/type-helpers.ts";
import { FlowHandleImpl } from "./flow-handle.ts";
import { RunController } from "./run-controller.ts";

// ── FlowEngine ─────────────────────────────────────────────────────

export class FlowEngine<
    TExtension extends object = object,
    TUserEvents extends ObjectRecord<TUserEvents> = EmptyEventMap,
> {
    private readonly eventBus: EventBus<EngineEventMap<TUserEvents>>;
    private readonly extensions: AnyExtension[] = [];
    private readonly registry = new Map<string, AnyFlowDefinition>();

    readonly events: EventSubscriberApi<EngineEventMap<TUserEvents>>;

    constructor(options?: FlowEngineOptions<TUserEvents>) {
        this.eventBus = new EventBus<EngineEventMap<TUserEvents>>(options?.onSubscriberError);
        this.events = this.eventBus.createSubscriberApi();

        for (const subscriber of options?.subscribers ?? []) {
            this.eventBus.register(subscriber);
        }
    }

    // ── Extension chaining ─────────────────────────────────────────

    extend<TNewExt extends object>(
        extension: Extension<TNewExt>
    ): FlowEngine<Simplify<TExtension & TNewExt>, TUserEvents> {
        this.extensions.push(extension as AnyExtension);
        // biome-ignore lint/suspicious/noExplicitAny: accumulative chaining requires type-level cast — same pattern as tRPC/Hono
        return this as any;
    }

    // ── Flow definition ────────────────────────────────────────────

    defineFlow<TContext extends TaskContext & TExtension>(input: FlowInput<TContext>): FlowDefinition<TContext> {
        return defineFlow<TContext>(input);
    }

    // ── Registration ───────────────────────────────────────────────

    register<TContext extends TaskContext & TExtension>(flow: FlowDefinition<TContext>): void {
        if (this.registry.has(flow.id)) {
            throw new FlowEngineError(`Flow "${flow.id}" is already registered`);
        }

        this.registry.set(flow.id, flow);
    }

    // ── Execution ──────────────────────────────────────────────────

    start<TContext extends TaskContext & TExtension>(
        flow: FlowDefinition<TContext>,
        params: ParamsOf<TContext>
    ): FlowHandle<StateOf<TContext>>;
    start(flowId: string, params: unknown): FlowHandle<StateShape>;
    start(flowOrId: AnyFlowDefinition | string, params: unknown): FlowHandle<StateShape> {
        const flow = this.resolveFlowDefinition(flowOrId);
        const plan = resolveFlow(flow);
        const runController = new RunController();
        const runId = randomUUID();

        const resultPromise = executeFlow({
            eventBus: this.eventBus,
            extensions: this.extensions,
            params,
            plan,
            runController,
            runId,
        });

        return new FlowHandleImpl(flow.id, runId, runController, resultPromise);
    }

    run<TContext extends TaskContext & TExtension>(
        flow: FlowDefinition<TContext>,
        params: ParamsOf<TContext>
    ): Promise<RunResult<StateOf<TContext>>>;
    run(flowId: string, params: unknown): Promise<RunResult<StateShape>>;
    run(flowOrId: AnyFlowDefinition | string, params: unknown): Promise<RunResult<StateShape>> {
        return this.start(flowOrId as string, params).join();
    }

    // ── Private ────────────────────────────────────────────────────

    private resolveFlowDefinition(flowOrId: AnyFlowDefinition | string): AnyFlowDefinition {
        if (typeof flowOrId !== "string") {
            return flowOrId;
        }

        const flow = this.registry.get(flowOrId);

        if (flow === undefined) {
            throw new FlowEngineError(`Flow "${flowOrId}" is not registered`);
        }

        return flow;
    }
}

// ── Factory ────────────────────────────────────────────────────────

export const createFlowEngine = <TUserEvents extends ObjectRecord<TUserEvents> = EmptyEventMap>(
    options?: FlowEngineOptions<TUserEvents>
): FlowEngine<object, TUserEvents> => new FlowEngine<object, TUserEvents>(options);
