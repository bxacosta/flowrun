/**
 * 07-requests.ts — Requests
 *
 * Covers:
 *  - request<TPayload, TResponse>() — portable typed request definitions
 *  - context.request(definition, payload, options?) inside a task
 *  - engine.requests.on(definition, handler) typed responder subscription
 *  - request.respond(response) typed answer from external code
 *  - Discriminated response types (multi-shape responses)
 *  - redact() hides secrets in bus events while keeping the actual response
 *  - timeout -> RequestTimeoutError
 *  - options.dedupeKey for idempotent prompts across task retries
 *  - handle.cancel() rejects pending requests with RequestCancelledError
 *
 * Demos 1 and 3 prompt the user interactively on a TTY; in non-interactive
 * contexts they fall back to an auto-answer so the example still completes.
 */

import { createEngine, flow, RequestTimeoutError, request } from "@flowrun/core";
import { isInteractive, log, prompt, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// ── Request definitions (portable tokens) ──────────────────────────
// Each request() is a plain value carrying payload/response types.
// The flow imports it to ask; the responder imports the same token to
// answer with full type safety.

const toolApproval = request<
    { args: Record<string, unknown>; toolName: string },
    { decision: "allow" | "deny"; note?: string }
>({ name: "tool-approval" });

const outputReview = request<
    { draft: string },
    { action: "approve" } | { action: "edit"; revised: string } | { action: "reject"; reason: string }
>({ name: "output-review" });

const credentialsRequest = request<{ service: string }, { apiKey: string }>({
    name: "credentials",
    // redact runs only when the manager emits events. The promise returned
    // by context.request still resolves to the full response — only event
    // subscribers see the masked version.
    redact: (record) => {
        const response = record.response as { apiKey: string } | undefined;
        return {
            ...record,
            response: response ? { apiKey: `${response.apiKey.slice(0, 3)}***` } : undefined,
        };
    },
});

const mfaCodeRequest = request<{ destination: string }, { code: string }>({
    name: "mfa-code",
});

const routingDecision = request<{ question: string }, { route: "yes" | "no" }>({
    name: "routing",
});

// ── Flows ──────────────────────────────────────────────────────────

// Demo 1: approval and execution share one task. context.skip() only skips
// the task it runs in — if approval lived in a separate task, skipping it
// would not prevent later tasks from running. Gating execution via skip
// therefore requires both to share a task body.
const callToolFlow = flow("call-tool")
    .state({ note: "", status: "pending" as string })
    .nodes(({ task }) => [
        task({
            name: "send-email",
            run: async (context) => {
                const decision = await context.request(toolApproval, {
                    args: { body: "Quarterly report attached.", to: "boss@example.com" },
                    toolName: "send-email",
                });
                if (decision.decision === "deny") {
                    context.skip(decision.note ?? "denied");
                }
                context.state.patch({ note: decision.note ?? "approved", status: "email sent" });
            },
        }),
    ]);

// Demo 2: discriminated response types let one request return multiple shapes.
const draftEmailFlow = flow("draft-email")
    .state({ final: "" })
    .nodes(({ task }) => [
        task({
            name: "draft",
            run: (context) => {
                context.state.set("final", "Hello team, the quarterly report is attached.");
            },
        }),
        task({
            name: "review",
            run: async (context) => {
                const decision = await context.request(outputReview, { draft: context.state.get("final") });
                if (decision.action === "approve") {
                    return;
                }
                if (decision.action === "edit") {
                    context.state.set("final", decision.revised);
                    return;
                }
                context.skip(decision.reason);
            },
        }),
    ]);

// Demo 3: redact hides secrets in events but the task code still has the real value.
const authFlow = flow("auth")
    .state({ keySuffix: "" })
    .nodes(({ task }) => [
        task({
            name: "get-key",
            run: async (context) => {
                const credentials = await context.request(credentialsRequest, { service: "OpenAI" });
                context.state.set("keySuffix", credentials.apiKey.slice(-4));
            },
        }),
    ]);

// Demo 4: timeout -> RequestTimeoutError. Nothing responds to mfaCodeRequest.
const mfaFlow = flow("mfa")
    .state({ outcome: "" })
    .nodes(({ task }) => [
        task({
            name: "ask-mfa",
            onError: "skip",
            run: async (context) => {
                try {
                    await context.request(mfaCodeRequest, { destination: "+1-555-0100" }, { timeoutMs: 60 });
                    context.state.set("outcome", "received");
                } catch (error) {
                    if (error instanceof RequestTimeoutError) {
                        context.state.set("outcome", "timed-out");
                        return;
                    }
                    throw error;
                }
            },
        }),
    ]);

// Demo 5: options.key makes the prompt idempotent across task retries.
const flakyDecisionFlow = flow("flaky-decision")
    .state({ answered: "", finalAttempt: 0 })
    .nodes(({ task }) => [
        task({
            name: "decide-then-act",
            retry: { attempts: 3, backoff: "constant", delayMs: 5 },
            run: async (context) => {
                const decision = await context.request(
                    routingDecision,
                    { question: "deploy to production?" },
                    { dedupeKey: "deploy" }
                );
                context.state.patch({ answered: decision.route, finalAttempt: context.attempt });
                if (context.attempt < 3) {
                    throw new Error("transient downstream failure");
                }
            },
        }),
    ]);

// Demo 6: handle.cancel() rejects any pending request for that run.
// Letting RequestCancelledError propagate is what makes the flow result
// `cancelled` — if a task catches it, the flow would complete normally.
const blockedFlow = flow("blocked").nodes(({ task }) => [
    task({
        name: "wait-on-approval",
        run: async (context) => {
            await context.request(toolApproval, { args: {}, toolName: "noop" });
        },
    }),
]);

// ── Engine ─────────────────────────────────────────────────────────

const engine = createEngine();
subscriber(engine.bus);

// ── Responders ─────────────────────────────────────────────────────
// Responders are registered with the typed token, so payload and response
// are fully type-checked. They can live anywhere — CLI prompt, web UI,
// webhook handler — and read the same `request` token the flow uses.

engine.requests.on(toolApproval, async (request) => {
    if (request.flowName === "blocked") {
        // Demo 6 cancels before this responder ever answers.
        return;
    }
    if (isInteractive()) {
        const args = JSON.stringify(request.payload.args);
        const answer = await prompt(`  tool="${request.payload.toolName}" args=${args} -- allow? (y/N) `);
        const decision = answer.toLowerCase().startsWith("y") ? "allow" : "deny";
        await request.respond({ decision, note: `human said ${decision}` });
        return;
    }
    log(`  [responder] tool="${request.payload.toolName}" -> allow`);
    await request.respond({ decision: "allow", note: "looks good" });
});

engine.requests.on(outputReview, async (request) => {
    log("  [responder] reviewing draft, applying edit");
    await request.respond({ action: "edit", revised: `${request.payload.draft} -- reviewed and approved.` });
});

engine.requests.on(credentialsRequest, async (request) => {
    if (isInteractive()) {
        const typed = await prompt(`  enter API key for ${request.payload.service}: `);
        await request.respond({ apiKey: typed || "sk-default-key-1234" });
        return;
    }
    log(`  [responder] credentials for ${request.payload.service} -> providing key`);
    await request.respond({ apiKey: "sk-real-key-1234" });
});

engine.requests.on(routingDecision, async (request) => {
    log(`  [responder] routing question: "${request.payload.question}" -> yes`);
    await request.respond({ route: "yes" });
});

// No responder registered for mfaCodeRequest — Demo 4 relies on timeout.

// ── Run ────────────────────────────────────────────────────────────

title("Demo 1 - basic request/respond (approval gates execution via skip)");
const result1 = await engine.run(callToolFlow);
if (result1.status === "success") {
    const skipped = result1.tasks.find((task) => task.status === "skipped");
    if (skipped) {
        log(`task skipped: ${skipped.reason ?? "no reason"}`);
    } else {
        log(`status: ${result1.state.status}, note: ${result1.state.note}`);
    }
}

title("Demo 2 - discriminated response (approve | edit | reject)");
const result2 = await engine.run(draftEmailFlow);
if (result2.status === "success") {
    log(`final draft: ${result2.state.final}`);
}

title("Demo 3 - redact: secrets hidden in events, real value in code");
let observedResponse: unknown;
const responseSubscription = engine.bus.subscribe("request:responded", (envelope) => {
    if (envelope.payload.name === "credentials") {
        observedResponse = envelope.payload.response;
    }
});
const result3 = await engine.run(authFlow);
responseSubscription.unsubscribe();
if (result3.status === "success") {
    log(`task captured real key (last 4: ${result3.state.keySuffix})`);
    log(`event subscriber saw: ${JSON.stringify(observedResponse)}`);
}

title("Demo 4 - timeout: no responder -> RequestTimeoutError");
const result4 = await engine.run(mfaFlow);
if (result4.status === "success") {
    log(`outcome: ${result4.state.outcome}`);
}

title("Demo 5 - idempotent key: one prompt across 3 retries");
let promptCount = 0;
const promptSubscription = engine.bus.subscribe("request:created", (envelope) => {
    if (envelope.payload.name === "routing") {
        promptCount++;
    }
});
const result5 = await engine.run(flakyDecisionFlow);
promptSubscription.unsubscribe();
if (result5.status === "success") {
    log(
        `task ran ${result5.state.finalAttempt} attempts, prompted ${promptCount} time, answer: ${result5.state.answered}`
    );
}

title("Demo 6 - handle.cancel() rejects pending requests");
const handle = await engine.start(blockedFlow);
setTimeout(() => {
    log(`  cancelling run ${handle.runId.slice(0, 8)}`);
    handle.cancel("operator cancelled");
}, 30);
const result6 = await handle.join();
if (result6.status === "cancelled") {
    log(`result: ${result6.status}, reason: ${result6.reason}`);
}
