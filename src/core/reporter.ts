import type { EngineEvent } from "./events.ts";

export interface Reporter {
    report(event: EngineEvent): void;
}

export interface ReporterRoute {
    filter?: (event: EngineEvent) => boolean;
    reporter: Reporter;
}

export class NoopReporter implements Reporter {
    report(_event: EngineEvent): void {
        // No-op: intentionally empty
    }
}

export class CompositeReporter implements Reporter {
    private readonly routes: ReporterRoute[];

    constructor(routes: ReporterRoute[]) {
        this.routes = [...routes];
    }

    report(event: EngineEvent): void {
        for (const route of this.routes) {
            try {
                if (!route.filter || route.filter(event)) {
                    route.reporter.report(event);
                }
            } catch {
                // Reporters must never crash the engine.
            }
        }
    }
}
