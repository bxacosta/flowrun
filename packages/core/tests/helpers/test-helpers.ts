import type { EngineEvent, Reporter } from "../../src/index.ts";

export class SpyReporter implements Reporter {
    readonly events: EngineEvent[] = [];

    report(event: EngineEvent): void {
        this.events.push(event);
    }

    byKind<TKind extends EngineEvent["kind"]>(kind: TKind): Extract<EngineEvent, { kind: TKind }>[] {
        return this.events.filter((event): event is Extract<EngineEvent, { kind: TKind }> => event.kind === kind);
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
