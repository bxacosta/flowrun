import {FlowEngine, defineFlow, type Middleware} from "../src";
import {ConsoleReporter} from "./shared/reporter.ts";
import {sleep} from "./shared/runtime.ts";

interface FulfillmentParams {
    orderId: string;
    customerTier: "standard" | "vip";
}

interface FulfillmentState {
    audit: string[];
    order?: {
        id: string;
        customerId: string;
        items: Array<{ sku: string; quantity: number; unitPrice: number }>;
    };
    inventory?: Array<{ sku: string; reserved: boolean }>;
    pricing?: {
        subtotal: number;
        discount: number;
        total: number;
    };
    fraudScore?: number;
    shipmentQuote?: {
        carrier: string;
        etaDays: number;
        amount: number;
    };
    recommendations?: string[];
    finalized?: boolean;
}

const timingMiddleware: Middleware<FulfillmentParams, FulfillmentState> = async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.log.info("Step timing", {
        step: ctx.step.name,
        durationMs: Date.now() - startedAt,
    });
};

let finalizeAttempts = 0;

const fulfillmentFlow = defineFlow<FulfillmentParams, FulfillmentState>({
    id: "order-fulfillment",
    name: "Order Fulfillment",
    initialState: {
        audit: [],
    },
    middleware: [timingMiddleware],
    build: ({parallel, sequence, step}) => [
        step("load-order", async (ctx) => {
            await sleep(80, ctx.signal);
            ctx.state.set("order", {
                id: ctx.params.orderId,
                customerId: "customer-77",
                items: [
                    {sku: "keyboard", quantity: 1, unitPrice: 120},
                    {sku: "mouse", quantity: 2, unitPrice: 35},
                ],
            });
        }),
        parallel(
            "prepare-order",
            [
                sequence("inventory-pipeline", [
                    step("check-inventory", async (ctx) => {
                        await sleep(120, ctx.signal);
                        const order = ctx.state.get("order");
                        if (!order) {
                            throw new Error("Order is missing");
                        }

                        ctx.state.set(
                            "inventory",
                            order.items.map((item) => ({sku: item.sku, reserved: true})),
                        );
                    }),
                ]),
                sequence("pricing-pipeline", [
                    step("calculate-pricing", async (ctx) => {
                        await sleep(60, ctx.signal);
                        const order = ctx.state.get("order");
                        if (!order) {
                            throw new Error("Order is missing");
                        }

                        const subtotal = order.items.reduce(
                            (sum, item) => sum + item.quantity * item.unitPrice,
                            0,
                        );
                        const discount = ctx.params.customerTier === "vip" ? 40 : 0;

                        ctx.state.set("pricing", {
                            subtotal,
                            discount,
                            total: subtotal - discount,
                        });
                    }),
                    step(
                        "fetch-shipment-quote",
                        async (ctx) => {
                            await sleep(110, ctx.signal);
                            ctx.state.set("shipmentQuote", {
                                carrier: "DHL",
                                etaDays: 2,
                                amount: 18,
                            });
                        },
                        {
                            use: [
                                async (ctx, next) => {
                                    ctx.log.info("Entering critical pricing step", {
                                        step: ctx.step.id,
                                    });
                                    await next();
                                },
                            ],
                        },
                    ),
                ]),
                sequence("risk-pipeline", [
                    step("run-fraud-check", async (ctx) => {
                        await sleep(40, ctx.signal);
                        ctx.state.set("fraudScore", 0.08);
                    }),
                    step(
                        "load-recommendations",
                        async (ctx) => {
                            await sleep(250, ctx.signal);
                            ctx.state.set("recommendations", ["usb-cable", "desk-mat"]);
                        },
                        {
                            timeoutMs: 100,
                            onError: "skip",
                        },
                    ),
                ]),
            ],
            {
                concurrency: 2,
                mode: "all-settled",
            },
        ),
        step("approve-order", async (ctx) => {
            const fraudScore = ctx.state.get("fraudScore") ?? 1;
            if (fraudScore > 0.7) {
                ctx.stop("Order blocked by fraud controls");
            }

            const audit = [...ctx.state.snapshot().audit];
            audit.push("approved:fraud-check");
            ctx.state.set("audit", audit);
        }),
        step(
            "finalize-order",
            async (ctx) => {
                finalizeAttempts += 1;
                await sleep(90, ctx.signal);

                if (finalizeAttempts === 1) {
                    throw new Error("Temporary database lock");
                }

                ctx.state.set("finalized", true);

                const audit = [...ctx.state.snapshot().audit];
                audit.push(`finalized:attempt-${finalizeAttempts}`);
                ctx.state.set("audit", audit);
            },
            {
                retry: {
                    attempts: 2,
                    delayMs: 150,
                    strategy: "exponential",
                },
            },
        ),
    ],
    onStart: async (ctx) => {
        ctx.state.set("audit", [...ctx.state.snapshot().audit, "flow-started"]);
        ctx.log.info("Starting fulfillment", {
            orderId: ctx.params.orderId,
            customerTier: ctx.params.customerTier,
        });
    },
    onSuccess: async (ctx, result) => {
        ctx.state.set("audit", [...ctx.state.snapshot().audit, "flow-succeeded"]);
        ctx.log.info("Fulfillment finished", {
            status: result.status,
            finalized: result.state.finalized,
            completedSteps: result.steps.filter((step) => step.status === "completed").length,
            skippedSteps: result.steps.filter((step) => step.status === "skipped").length,
        });
    },
    onComplete: async (ctx, result) => {
        ctx.state.set("audit", [...ctx.state.snapshot().audit, `flow-complete:${result.status}`]);
        ctx.log.info("Final snapshot", {
            status: result.status,
            state: result.state,
        });
    },
});

const engine = new FlowEngine({
    reporter: new ConsoleReporter(),
});

const result = await engine.run(fulfillmentFlow, {
    orderId: "order-1001",
    customerTier: "vip",
});

console.log("\nFinal result:");
console.log(JSON.stringify({
    status: result.status,
    durationMs: result.durationMs,
    steps: result.steps,
    state: result.state,
}, null, 2));
