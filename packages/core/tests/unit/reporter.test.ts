import { describe, expect, test } from "bun:test";
import { CompositeReporter } from "../../src/index.ts";
import { SpyReporter } from "../helpers/test-helpers.ts";

describe("CompositeReporter", () => {
    test("routes events to every reporter that matches", () => {
        const a = new SpyReporter();
        const b = new SpyReporter();
        const composite = new CompositeReporter([
            { reporter: a },
            { reporter: b, filter: (event) => event.kind !== "log" },
        ]);

        composite.report({
            kind: "flow:start",
            flowId: "flow",
            flowName: "Flow",
            runId: "run",
            timestamp: new Date(),
            params: {},
        });

        expect(a.events).toHaveLength(1);
        expect(b.events).toHaveLength(1);
    });

    test("swallows reporter failures so others still receive the event", () => {
        const good = new SpyReporter();
        const composite = new CompositeReporter([
            {
                reporter: {
                    report() {
                        throw new Error("boom");
                    },
                },
            },
            { reporter: good },
        ]);

        composite.report({
            kind: "flow:end",
            flowId: "flow",
            flowName: "Flow",
            runId: "run",
            timestamp: new Date(),
            status: "completed",
            durationMs: 1,
        });

        expect(good.events).toHaveLength(1);
    });
});
