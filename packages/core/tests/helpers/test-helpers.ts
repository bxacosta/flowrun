import { type EngineEvent, type EventSubscriber } from "../../src/index.ts";

export class EventSpy {
    readonly events: EngineEvent[] = [];

    subscriber = (events: EventSubscriber): void => {
        events.onAny((type, data) => {
            this.events.push({ ...data, type } as EngineEvent);
        });
    };

    byType(type: string): EngineEvent[] {
        return this.events.filter((event) => event.type === type);
    }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);

        if (!signal) {
            return;
        }

        if (signal.aborted) {
            clearTimeout(timer);
            reject(signal.reason);
            return;
        }

        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
            },
            { once: true }
        );
    });
}
