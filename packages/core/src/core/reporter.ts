import type { CoreEvents, EngineEvent, EventMeta } from "./events.ts";

export interface EventSubscriber<TEvents = CoreEvents> {
    on<K extends keyof TEvents & string>(type: K, handler: (data: TEvents[K] & EventMeta) => void): () => void;
    onAny(handler: (type: string, data: Record<string, unknown> & EventMeta) => void): () => void;
}

export class EventBus<TEvents = CoreEvents> implements EventSubscriber<TEvents> {
    private readonly handlers = new Map<string, Set<(event: unknown) => void>>();
    private readonly anyHandlers = new Set<(type: string, data: Record<string, unknown> & EventMeta) => void>();

    on<K extends keyof TEvents & string>(type: K, handler: (data: TEvents[K] & EventMeta) => void): () => void {
        let set = this.handlers.get(type);

        if (!set) {
            set = new Set();
            this.handlers.set(type, set);
        }

        const wrapped = handler as (event: unknown) => void;
        set.add(wrapped);

        return () => set.delete(wrapped);
    }

    onAny(handler: (type: string, data: Record<string, unknown> & EventMeta) => void): () => void {
        this.anyHandlers.add(handler);
        return () => this.anyHandlers.delete(handler);
    }

    dispatch(event: EngineEvent): void {
        const typed = this.handlers.get(event.type);

        if (typed) {
            for (const handler of typed) {
                try {
                    handler(event);
                } catch {
                    // Handlers must never crash the engine.
                }
            }
        }

        if (this.anyHandlers.size > 0) {
            const data = event as unknown as Record<string, unknown> & EventMeta;

            for (const handler of this.anyHandlers) {
                try {
                    handler(event.type, data);
                } catch {
                    // Handlers must never crash the engine.
                }
            }
        }
    }
}
