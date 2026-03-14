import type { CoreEvents, EngineEvent, EventMeta } from "./events.ts";

export interface Reporter {
    report(event: EngineEvent): void;
}

export class EventReporter<TEvents = CoreEvents> implements Reporter {
    private readonly handlers = new Map<string, Set<(event: unknown) => void>>();
    private readonly anyHandlers = new Set<(event: EngineEvent) => void>();

    on<K extends keyof TEvents & string>(type: K, handler: (event: TEvents[K] & EventMeta) => void): () => void {
        let set = this.handlers.get(type);

        if (!set) {
            set = new Set();
            this.handlers.set(type, set);
        }

        const wrapped = handler as (event: unknown) => void;
        set.add(wrapped);

        return () => set.delete(wrapped);
    }

    onAny(handler: (event: EngineEvent) => void): () => void {
        this.anyHandlers.add(handler);
        return () => this.anyHandlers.delete(handler);
    }

    report(event: EngineEvent): void {
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

        for (const handler of this.anyHandlers) {
            try {
                handler(event);
            } catch {
                // Handlers must never crash the engine.
            }
        }
    }
}
