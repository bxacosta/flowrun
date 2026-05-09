/**
 * 07-requests.ts -- Requests: typed human-in-the-loop primitive
 *
 * A `request` is a typed pause point: the flow asks for something and waits
 * for an external responder (a human via UI, an approval service, a webhook)
 * to answer. This is the same pattern agent SDKs like Mastra and LangGraph
 * use for HITL: pre-tool approvals, output review, credential prompts,
 * routing decisions.
 *
 * Covers:
 *  - define.request<TPayload, TResponse>() -- portable request definitions
 *  - context.request(definition, payload, options?) inside a task
 *  - engine.requests.on(definition, handler) typed responder subscription
 *  - request.respond(response) typed answer from external code
 *  - Discriminated response types (approve | edit | reject)
 *  - redact() hides secrets in bus events while keeping the actual response
 *  - timeout -> RequestTimeoutError
 *  - options.key for idempotent prompts across task retries
 *  - handle.cancel() rejects pending requests with RequestCancelledError
 *
 * Demos 1 and 3 prompt the user interactively when run on a TTY; in
 * non-interactive contexts (CI, piped output) they fall back to auto-answer
 * so the full example still completes end-to-end.
 */

import { createEngine, define, RequestTimeoutError } from "@flowrun/core";
import { isInteractive, log, prompt, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// -- Request definitions (portable tokens) ---------------------------
//
// Each `define.request` is a plain value that carries the payload/response
// types. It can live in a shared package -- the flow imports it to ask, the
// CLI/UI imports the same token to answer with full type safety.

const toolApproval = define.request<
    { args: Record<string, unknown>; toolName: string },
    { decision: "allow" | "deny"; note?: string }
>({ name: "agent.tool-approval" });

const outputReview = define.request<
    { draft: string },
    { action: "approve" } | { action: "edit"; revised: string } | { action: "reject"; reason: string }
>({ name: "agent.output-review" });

const credentialsRequest = define.request<{ service: string }, { apiKey: string }>({
    name: "agent.credentials",
    // redact runs only when the manager emits events. The promise returned by
    // ctx.request still resolves to the full response -- only subscribers see
    // the masked version.
    redact: (record) => {
        const response = record.response as { apiKey: string } | undefined;
        return {
            ...record,
            response: response ? { apiKey: `${response.apiKey.slice(0, 3)}***` } : undefined,
        };
    },
});

const mfaCodeRequest = define.request<{ destination: string }, { code: string }>({
    name: "agent.mfa-code",
});

const routingDecision = define.request<{ question: string }, { route: "yes" | "no" }>({
    name: "agent.routing",
});

// -- Flows -----------------------------------------------------------

// Demo 1: approval and execution share one task. `ctx.skip()` only skips the
// task it runs in -- if approval lived in a separate task, skipping it would
// not prevent later tasks from running. Gating execution via skip therefore
// requires both to share a task body.
const callToolFlow = define.flow({
    name: "agent-call-tool",
    state: () => ({ note: "", status: "pending" as string }),
    nodes: ({ task }) => [
        task({
            name: "send-email",
            run: async (context) => {
                const decision = await context.request(toolApproval, {
                    args: { body: "Quarterly report attached.", to: "boss@example.com" },
                    toolName: "send-email",
                });
                if (decision.decision === "deny") {
                    context.skip(decision.note ?? "denied by human");
                }
                context.state.patch({ note: decision.note ?? "approved", status: "email sent" });
            },
        }),
    ],
});

// Demo 2: discriminated response types model rich human decisions.
const draftEmailFlow = define.flow({
    name: "agent-draft-email",
    state: () => ({ final: "" }),
    nodes: ({ task }) => [
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
    ],
});

// Demo 3: redact hides secrets in events but the task code still has the real value.
const authFlow = define.flow({
    name: "agent-auth",
    state: () => ({ keySuffix: "" }),
    nodes: ({ task }) => [
        task({
            name: "get-key",
            run: async (context) => {
                const creds = await context.request(credentialsRequest, { service: "OpenAI" });
                context.state.set("keySuffix", creds.apiKey.slice(-4));
            },
        }),
    ],
});

// Demo 4: timeout -> RequestTimeoutError. Nothing responds to mfaCodeRequest.
const mfaFlow = define.flow({
    name: "agent-mfa",
    state: () => ({ outcome: "" }),
    nodes: ({ task }) => [
        task({
            name: "ask-mfa",
            onError: "skip",
            run: async (context) => {
                try {
                    await context.request(mfaCodeRequest, { destination: "+1-555-0100" }, { timeout: 60 });
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
    ],
});

// Demo 5: options.key makes the prompt idempotent across task retries.
const flakyDecisionFlow = define.flow({
    name: "agent-flaky-decision",
    state: () => ({ answered: "", finalAttempt: 0 }),
    nodes: ({ task }) => [
        task({
            name: "decide-then-act",
            retry: { attempts: 3, backoff: "constant", delayMs: 5 },
            run: async (context) => {
                const decision = await context.request(
                    routingDecision,
                    { question: "deploy to production?" },
                    { key: "deploy" }
                );
                context.state.patch({ answered: decision.route, finalAttempt: context.attempt });
                if (context.attempt < 3) {
                    throw new Error("transient downstream failure");
                }
            },
        }),
    ],
});

// Demo 6: handle.cancel() rejects any pending request for that run.
// Letting RequestCancelledError propagate is what makes the flow result
// `cancelled` -- if a task catches it, the flow would complete normally.
const blockedFlow = define.flow({
    name: "agent-blocked",
    nodes: ({ task }) => [
        task({
            name: "wait-on-approval",
            run: async (context) => {
                await context.request(toolApproval, { args: {}, toolName: "noop" });
            },
        }),
    ],
});

// -- Engine ----------------------------------------------------------

const engine = createEngine();
subscriber(engine.bus);

// -- Responders (simulated humans) -----------------------------------
//
// In a real app these handlers live in a CLI prompt, web UI, Slack bot, or
// webhook route. They are registered with the typed token, so payload and
// response are fully type-checked.

engine.requests.on(toolApproval, async (request) => {
    if (request.flowName === "agent-blocked") {
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

// No responder registered for mfaCodeRequest -- Demo 4 relies on timeout.

// -- Run -------------------------------------------------------------

title("Demo 1 - basic request/respond (tool approval gates execution)");
const result1 = await engine.run(callToolFlow);
if (result1.status === "success") {
    const skipped = result1.tasks.find((task) => task.status === "skipped");
    if (skipped) {
        log(`tool was not executed (skipped: ${skipped.reason ?? "no reason"})`);
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
    if (envelope.payload.name === "agent.credentials") {
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
    if (envelope.payload.name === "agent.routing") {
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
