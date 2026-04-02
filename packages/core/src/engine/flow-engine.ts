import { randomUUID } from "node:crypto";
import { FlowEngineError } from "../core/errors.ts";
import type {
    AnyFlowDefinition,
    EmptyEventMap,
    EngineEventMap,
    EventSubscriberApi,
    Extension,
    ExtensionApi,
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

// ── Extension helpers ──────────────────────────────────────────────

const registerExtensionKeys = (usedKeys: Set<string>, extensionContext: object): void => {
    for (const key of Object.keys(extensionContext)) {
        if (usedKeys.has(key)) {
            throw new FlowEngineError(`Extension key "${key}" collides with a key from a previously created extension`);
        }
        usedKeys.add(key);
    }
};

const rollbackExtensions = async (
    extensions: readonly Extension<object>[],
    contexts: readonly object[],
    extensionApi: ExtensionApi
): Promise<void> => {
    for (let i = contexts.length - 1; i >= 0; i--) {
        const extension = extensions[i];
        const ctx = contexts[i];
        if (extension?.dispose !== undefined && ctx !== undefined) {
            try {
                await extension.dispose(ctx, extensionApi);
            } catch {
                // Swallow disposal errors during rollback
            }
        }
    }
};

const normalizeExtensions = (extensions: readonly Extension<object>[]): Extension<object> | undefined => {
    if (extensions.length === 0) {
        return undefined;
    }

    if (extensions.length === 1) {
        return extensions[0];
    }

    const runContexts = new Map<string, object[]>();

    return {
        create: async (extensionApi: ExtensionApi) => {
            const contexts: object[] = [];
            const usedKeys = new Set<string>();
            let merged: object = {};

            try {
                for (const extension of extensions) {
                    const extensionContext = await extension.create(extensionApi);
                    contexts.push(extensionContext);
                    registerExtensionKeys(usedKeys, extensionContext);
                    merged = { ...merged, ...extensionContext };
                }
            } catch (error) {
                await rollbackExtensions(extensions, contexts, extensionApi);
                throw error;
            }

            runContexts.set(extensionApi.runId, contexts);
            return merged;
        },
        dispose: async (_mergedContext: object, extensionApi: ExtensionApi) => {
            const contexts = runContexts.get(extensionApi.runId);
            runContexts.delete(extensionApi.runId);

            if (contexts === undefined) {
                return;
            }

            for (let i = extensions.length - 1; i >= 0; i--) {
                const extension = extensions[i];
                const ctx = contexts[i];
                if (extension?.dispose !== undefined && ctx !== undefined) {
                    await extension.dispose(ctx, extensionApi);
                }
            }
        },
    };
};

// ── FlowEngine ─────────────────────────────────────────────────────

export class FlowEngine<
    TExtension extends object = object,
    TUserEvents extends ObjectRecord<TUserEvents> = EmptyEventMap,
> {
    private readonly eventBus: EventBus<EngineEventMap<TUserEvents>>;
    private readonly extensionRegistry: Extension<object>[] = [];
    private readonly registry = new Map<string, AnyFlowDefinition>();
    private normalizedExtension: Extension<object> | undefined;
    private extensionsDirty = false;

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
        this.extensionRegistry.push(extension as Extension<object>);
        this.extensionsDirty = true;
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
            extension: this.resolveExtension(),
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

    private resolveExtension(): Extension<object> | undefined {
        if (this.extensionsDirty) {
            this.normalizedExtension = normalizeExtensions(this.extensionRegistry);
            this.extensionsDirty = false;
        }

        return this.normalizedExtension;
    }

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
