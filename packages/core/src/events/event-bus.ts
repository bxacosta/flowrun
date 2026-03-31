import type {
    AnyEventEnvelope,
    EventEnvelope,
    EventHandler,
    EventMetadata,
    EventSubscriber,
    EventSubscriberApi,
} from "../core/types.ts";

export interface DispatchOptions<TType extends string, TPayload extends object> {
    readonly flowId: string;
    readonly payload: TPayload;
    readonly runId: string;
    readonly type: TType;
}

type AnyHandler<TEvents extends Record<string, object>> = {
    [TType in keyof TEvents & string]: EventHandler<TType, TEvents[TType]>;
}[keyof TEvents & string];

export class EventBus<TEvents extends Record<string, object>> {
    private readonly anyHandlers = new Set<
        (type: keyof TEvents & string, event: AnyEventEnvelope<TEvents>) => void | Promise<void>
    >();
    private readonly handlers = new Map<keyof TEvents & string, Set<AnyHandler<TEvents>>>();
    private readonly onSubscriberError: ((error: Error, type: string) => void) | undefined;

    constructor(onSubscriberError?: (error: Error, type: string) => void) {
        this.onSubscriberError = onSubscriberError;
    }

    createSubscriberApi(): EventSubscriberApi<TEvents> {
        return {
            on: (type, handler) => this.on(type, handler),
            onAny: (handler) => this.onAny(handler),
        };
    }

    dispatch<TType extends keyof TEvents & string>(options: DispatchOptions<TType, TEvents[TType]>): void {
        const event = this.createEnvelope(options);
        const directHandlers = this.handlers.get(options.type);

        if (directHandlers !== undefined) {
            for (const handler of directHandlers) {
                this.runHandler(options.type, () => handler(event as EventEnvelope<TType, TEvents[TType]>));
            }
        }

        for (const handler of this.anyHandlers) {
            this.runHandler(options.type, () => handler(options.type, event as AnyEventEnvelope<TEvents>));
        }
    }

    on<TType extends keyof TEvents & string>(type: TType, handler: EventHandler<TType, TEvents[TType]>): () => void {
        const existing = this.handlers.get(type);
        const handlerSet = existing ?? new Set<AnyHandler<TEvents>>();

        if (existing === undefined) {
            this.handlers.set(type, handlerSet);
        }

        handlerSet.add(handler as AnyHandler<TEvents>);

        return () => {
            handlerSet.delete(handler as AnyHandler<TEvents>);

            if (handlerSet.size === 0) {
                this.handlers.delete(type);
            }
        };
    }

    onAny(
        handler: (type: keyof TEvents & string, event: AnyEventEnvelope<TEvents>) => void | Promise<void>
    ): () => void {
        this.anyHandlers.add(handler);
        return () => {
            this.anyHandlers.delete(handler);
        };
    }

    register(subscriber: EventSubscriber<TEvents>): void {
        subscriber(this.createSubscriberApi());
    }

    private createEnvelope<TType extends keyof TEvents & string>(
        options: DispatchOptions<TType, TEvents[TType]>
    ): EventEnvelope<TType, TEvents[TType]> {
        const metadata: EventMetadata<TType> = {
            flowId: options.flowId,
            runId: options.runId,
            timestamp: new Date(),
            type: options.type,
        };

        return {
            ...options.payload,
            ...metadata,
        };
    }

    private runHandler(type: string, handler: () => void | Promise<void>): void {
        try {
            const result = handler();

            if (result instanceof Promise) {
                result.catch((error: unknown) => {
                    this.handleError(type, error);
                });
            }
        } catch (error) {
            this.handleError(type, error);
        }
    }

    private handleError(type: string, error: unknown): void {
        if (this.onSubscriberError === undefined) {
            return;
        }

        this.onSubscriberError(error instanceof Error ? error : new Error(String(error)), type);
    }
}

// biome-ignore lint/suspicious/noExplicitAny: type erasure — invariant generic requires `any` for heterogeneous storage
export type AnyEventBus = EventBus<any>;
