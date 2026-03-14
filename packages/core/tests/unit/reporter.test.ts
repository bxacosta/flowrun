import { describe, expect, test } from "bun:test";
import { EventBus, type EventMeta } from "../../src/index.ts";

describe("EventBus", () => {
    test("dispatches typed events to registered handlers", () => {
        const bus = new EventBus();
        const received: unknown[] = [];

        bus.on("flow.started", (data) => {
            received.push(data.flowName);
        });

        const event = {
            type: "flow.started" as const,
            flowId: "flow",
            flowName: "Flow",
            runId: "run",
            timestamp: new Date(),
            params: {},
        };
        bus.dispatch(event);

        expect(received).toEqual(["Flow"]);
    });

    test("dispatches to onAny handlers with (type, data) signature", () => {
        const bus = new EventBus();
        const received: Array<{ type: string; data: Record<string, unknown> & EventMeta }> = [];

        bus.onAny((type, data) => received.push({ type, data }));

        const event = {
            type: "flow.started" as const,
            flowId: "flow",
            flowName: "Flow",
            runId: "run",
            timestamp: new Date(),
            params: {},
        };
        bus.dispatch(event);

        expect(received).toHaveLength(1);
        expect(received[0]?.type).toBe("flow.started");
        expect(received[0]?.data.flowId).toBe("flow");
    });

    test("unsubscribe removes handler", () => {
        const bus = new EventBus();
        const received: unknown[] = [];

        const off = bus.on("flow.started", (data) => {
            received.push(data.flowName);
        });

        const event = {
            type: "flow.started" as const,
            flowId: "flow",
            flowName: "Flow",
            runId: "run",
            timestamp: new Date(),
            params: {},
        };

        bus.dispatch(event);
        off();
        bus.dispatch(event);

        expect(received).toHaveLength(1);
    });

    test("swallows handler errors so other handlers still receive the event", () => {
        const bus = new EventBus();
        const received: string[] = [];

        bus.on("flow.ended", () => {
            throw new Error("boom");
        });

        bus.onAny((type) => received.push(type));

        const event = {
            type: "flow.ended" as const,
            flowId: "flow",
            flowName: "Flow",
            runId: "run",
            timestamp: new Date(),
            status: "completed" as const,
            durationMs: 1,
        };
        bus.dispatch(event);

        expect(received).toHaveLength(1);
    });
});
