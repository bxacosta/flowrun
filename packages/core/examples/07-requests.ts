/**
 * 07-requests.ts — Requests
 *
 * Covers:
 *  - request<TPayload, TResponse>() - portable typed request definitions
 *  - context.request(definition, payload, options?) inside a task
 *  - engine.requests.on(definition, handler) typed responder subscription
 *  - request.respond(response) typed answer from external code
 *  - Discriminated response types (multi-shape responses)
 *  - redact() hides secrets in bus events while keeping the actual response
 *  - timeoutMs -> RequestExpiredError
 *  - options.idempotencyKey for idempotent prompts across task retries
 *  - options.metadata / respond(.., { metadata }) - metadata on request:created & request:resolved
 *  - handle.cancel() rejects pending requests with RequestCancelledError
 *  - engine.requests.list(filter) / get(id) / respond(definition, id, response) - inspect & answer by id
 *  - engine.requests.cancel(id) cancels one pending request by id (the run keeps going)
 *  - engine.requests.on(def, handler, { replayPending }) replays still-pending requests to a late subscriber
 *
 * Demos 1 and 3 prompt the user interactively on a TTY; in non-interactive
 * contexts they fall back to an auto-answer so the example still completes.
 */

import { createEngine, flow, RequestCancelledError, RequestExpiredError, request } from "@flowrun/core";
import { delay, isInteractive, log, prompt, title } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// ── Request definitions (portable tokens) ──────────────────────────
// Each request() is a plain value carrying payload/response types. The flow
// imports it to ask; the responder imports the same token to answer, both
// fully type-checked.

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
    // redact runs only when the manager emits events. The promise returned by
    // context.request still resolves to the full response - only event
    // subscribers see the masked version.
    redact: (record) => {
        const response = record.response as { apiKey: string } | undefined;
        return {
            ...record,
            response: response ? { apiKey: `${response.apiKey.slice(0, 3)}***` } : undefined,
        };
    },
});

const mfaCodeRequest = request<{ destination: string }, { code: string }>({ name: "mfa-code" });

const routingDecision = request<{ question: string }, { route: "yes" | "no" }>({ name: "routing" });

// Demo 7 answers this one at the engine level (no on() responder registered).
const manualApproval = request<{ step: string }, { ok: boolean }>({ name: "manual-approval" });

// Demo 8 leaves this one unanswered so it stays pending for a late subscriber to
// replay and for engine.requests.cancel(id) to cancel by id.
const sideChannel = request<{ question: string }, { go: boolean }>({ name: "side-channel" });

// ── Engine ─────────────────────────────────────────────────────────

const engine = createEngine();
subscriber(engine.events);

// ── Responders ─────────────────────────────────────────────────────
// Responders are registered with the typed token, so payload and response are
// fully type-checked. They can live anywhere (CLI prompt, web UI, webhook)
// and read the same `request` token the flow uses.

engine.requests.on(toolApproval, async (req) => {
    if (req.flowName === "blocked") {
        // Demo 6 cancels before this responder ever answers.
        return;
    }
    if (isInteractive()) {
        const args = JSON.stringify(req.payload.args);
        const answer = await prompt(`  tool="${req.payload.toolName}" args=${args} -- allow? (y/N) `);
        const decision = answer.toLowerCase().startsWith("y") ? "allow" : "deny";
        await req.respond({ decision, note: `human said ${decision}` });
        return;
    }
    log(`  [responder] tool="${req.payload.toolName}" -> allow`);
    await req.respond({ decision: "allow", note: "looks good" });
});

engine.requests.on(outputReview, async (req) => {
    log("  [responder] reviewing draft, applying edit");
    await req.respond({ action: "edit", revised: `${req.payload.draft} -- reviewed and approved.` });
});

engine.requests.on(credentialsRequest, async (req) => {
    if (isInteractive()) {
        const typed = await prompt(`  enter API key for ${req.payload.service}: `);
        await req.respond({ apiKey: typed || "sk-default-key-1234" });
        return;
    }
    log(`  [responder] credentials for ${req.payload.service} -> providing key`);
    await req.respond({ apiKey: "sk-real-key-1234" });
});

engine.requests.on(routingDecision, async (req) => {
    log(`  [responder] routing question: "${req.payload.question}" -> yes`);
    await req.respond({ route: "yes" });
});

// No responder for mfaCodeRequest (Demo 4 relies on timeout) or manualApproval
// (Demo 7 answers it through engine.requests instead).

// ── Demo 1: basic request/respond, approval gates execution via skip ─
// Approval and execution share one task. context.skip() only skips the task it
// runs in, so gating later work on an approval requires them in the same body.

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

// ── Demo 2: discriminated response types (one request, many shapes) ─

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

title("Demo 2 - discriminated response (approve | edit | reject)");
const result2 = await engine.run(draftEmailFlow);
if (result2.status === "success") {
    log(`final draft: ${result2.state.final}`);
}

// ── Demo 3: redact hides secrets in events, real value stays in code ─

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

title("Demo 3 - redact: secrets hidden in events, real value in code");
let observedResponse: unknown;
const responseSubscription = engine.events.on("request:resolved", (envelope) => {
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

// ── Demo 4: timeout -> RequestExpiredError (nothing answers) ─────────

const mfaFlow = flow("mfa")
    .state({ outcome: "" })
    .nodes(({ task }) => [
        task({
            name: "ask-mfa",
            onError: "ignore",
            run: async (context) => {
                try {
                    await context.request(mfaCodeRequest, { destination: "+1-555-0100" }, { timeoutMs: 60 });
                    context.state.set("outcome", "received");
                } catch (error) {
                    if (error instanceof RequestExpiredError) {
                        context.state.set("outcome", "timed-out");
                        return;
                    }
                    throw error;
                }
            },
        }),
    ]);

title("Demo 4 - timeout: no responder -> RequestExpiredError");
const result4 = await engine.run(mfaFlow);
if (result4.status === "success") {
    log(`outcome: ${result4.state.outcome}`);
}

// ── Demo 5: idempotencyKey - one prompt shared across task retries ──

const flakyDecisionFlow = flow("flaky-decision")
    .state({ answered: "", finalAttempt: 0 })
    .nodes(({ task }) => [
        task({
            name: "decide-then-act",
            retry: { backoff: "constant", delayMs: 5, maxAttempts: 3 },
            run: async (context) => {
                const decision = await context.request(
                    routingDecision,
                    { question: "deploy to production?" },
                    { idempotencyKey: "deploy" }
                );
                context.state.patch({ answered: decision.route, finalAttempt: context.attempt });
                if (context.attempt < 3) {
                    throw new Error("transient downstream failure");
                }
            },
        }),
    ]);

title("Demo 5 - idempotent key: one prompt across 3 retries");
let promptCount = 0;
const promptSubscription = engine.events.on("request:created", (envelope) => {
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

// ── Demo 6: handle.cancel() rejects pending requests ────────────────
// Letting RequestCancelledError propagate is what makes the result `cancelled`;
// a task that catches it would let the flow complete normally.

const blockedFlow = flow("blocked").nodes(({ task }) => [
    task({
        name: "wait-on-approval",
        run: async (context) => {
            await context.request(toolApproval, { args: {}, toolName: "noop" });
        },
    }),
]);

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

// ── Demo 7: inspect & answer at the engine level (no PendingRequest) ─

const manualFlow = flow("manual")
    .state({ answered: false })
    .nodes(({ task }) => [
        task({
            name: "await-manual",
            run: async (context) => {
                // options.metadata travels with the request and surfaces on request:created.
                const decision = await context.request(
                    manualApproval,
                    { step: "deploy" },
                    { metadata: { requestedBy: "scheduler" } }
                );
                context.state.set("answered", decision.ok);
            },
        }),
    ]);

title("Demo 7 - inspect & answer by id (+ request/response metadata)");
// responseMetadata is only visible on the request:resolved event, not the record.
let observedResponseMetadata: unknown;
const metadataSubscription = engine.events.on("request:resolved", (envelope) => {
    if (envelope.payload.name === "manual-approval") {
        observedResponseMetadata = envelope.payload.responseMetadata;
    }
});
const handle7 = await engine.start(manualFlow);
// Give the task a tick to open its request, then inspect the pending queue.
await delay(10);
const pending = engine.requests.list({ name: "manual-approval", status: "pending" });
log(`  pending requests: ${pending.length}`);
const first = pending[0];
if (first) {
    // get(id) returns the full record, including the request metadata.
    const record = engine.requests.get(first.id);
    const requestedBy = (record?.metadata as { requestedBy?: string } | undefined)?.requestedBy;
    log(
        `  inspecting "${record?.name}" step="${(record?.payload as { step: string }).step}" requestedBy=${requestedBy}`
    );
    // respond(def, id, response, { metadata }) answers by id and attaches response metadata.
    await engine.requests.respond(manualApproval, first.id, { ok: true }, { metadata: { approver: "ops-oncall" } });
}
const result7 = await handle7.join();
metadataSubscription.unsubscribe();
if (result7.status === "success") {
    log(`answered: ${result7.state.answered}, responseMetadata: ${JSON.stringify(observedResponseMetadata)}`);
}

// ── Demo 8: cancel one request by id + late subscriber replay ───────
// engine.requests.cancel(id) cancels a single pending request (the run keeps
// going), unlike handle.cancel() in Demo 6 which cancels the whole run.

const sideChannelFlow = flow("side-channel-flow")
    .state({ outcome: "" })
    .nodes(({ task }) => [
        task({
            name: "await-side-channel",
            run: async (context) => {
                try {
                    await context.request(sideChannel, { question: "ship it?" });
                    context.state.set("outcome", "answered");
                } catch (error) {
                    if (error instanceof RequestCancelledError) {
                        // Catching the rejection lets the task (and the run) finish normally.
                        context.state.set("outcome", "cancelled-request");
                        return;
                    }
                    throw error;
                }
            },
        }),
    ]);

title("Demo 8 - requests.cancel(id) + late subscriber replay (replayPending)");
const handle8 = await engine.start(sideChannelFlow);
await delay(10);
// A subscriber registered after the request opened still sees it: replayPending
// (default true) replays still-pending requests to the new subscriber.
const lateSubscription = engine.requests.on(
    sideChannel,
    (req) => log(`  [late subscriber] replayed pending request "${req.name}" question="${req.payload.question}"`),
    { replayPending: true }
);
const open = engine.requests.list({ name: "side-channel", status: "pending" })[0];
if (open) {
    await engine.requests.cancel(open.id, "no decision needed");
}
const result8 = await handle8.join();
lateSubscription.unsubscribe();
if (result8.status === "success") {
    log(`outcome: ${result8.state.outcome} (run survived a per-request cancel)`);
}
