/**
 * 07-interactive.ts — Interactive Flow with Terminal Controls
 *
 * Covers:
 *  - engine.start(flow) -> FlowHandle (non-blocking execution)
 *  - Keyboard controls: pause, resume, cancel, status
 *  - Human-in-the-loop: a task that waits for user input via bus.waitFor()
 *  - Cooperative cancellation with context.signal
 *  - Console subscriber for live event visibility
 *
 * Run: bun run examples2/07-interactive.ts
 */

import { emitKeypressEvents } from "node:readline";
import { createEngine, define, event } from "@flowrun/core"
import { colorize, log, simulateWork } from "./shared/helpers.ts";
import { subscriber } from "./shared/subscriber.ts";

// ── Human-in-the-loop extension ─────────────────────────────────────
//
// The extension captures the PublishableBus in provide() and exposes a
// provideInput() method so external code (CLI, dashboard) can publish
// input:provided events without needing direct bus access.

function createInputExtension() {
    let publishInput: ((field: string, runId: string, value: string) => Promise<void>) | null = null;

    const extension = define.extension({
        name: "input",
        events: {
            "input:requested": event.public<{ field: string; prompt: string; runId: string }>(),
            "input:provided": event.public<{ field: string; runId: string; value: string }>(),
        },
        provide(context) {
            publishInput = (field, runId, value) =>
                context.bus.publish("input:provided", { field, runId, value }, { source: "external" });
            return {};
        },
    });

    return {
        extension,
        provideInput(field: string, runId: string, value: string) {
            return publishInput?.(field, runId, value);
        },
    };
}

interface InputContract {
    events: {
        "input:provided": { field: string; runId: string; value: string };
        "input:requested": { field: string; prompt: string; runId: string };
    };
    state: {
        apiKey: string;
        recordsImported: number;
        steps: string[];
        validated: boolean;
    };
}

// ── Engine ──────────────────────────────────────────────────────────

const input = createInputExtension();
const engine = createEngine({ events: { bufferSize: 100 } }).use(input.extension);
subscriber(engine.bus);

// ── Flow: data import pipeline with human-in-the-loop ───────────────

const importPipeline = define.scope<InputContract>().flow({
    name: "data-import",
    state: () => ({
        apiKey: "",
        recordsImported: 0,
        steps: [] as string[],
        validated: false,
    }),
    nodes: ({ task }) => [
        task({
            name: "prepare",
            run: async (context) => {
                context.log.info("preparing import environment");
                await simulateWork(500, context.signal);
                context.state.set("steps", ["prepare"]);
            },
        }),

        // Human-in-the-loop: waits for user to provide an API key
        task({
            name: "request-credentials",
            run: async (context) => {
                log(`\n  ${colorize("yellow", "INPUT REQUIRED")}  Type your API key and press Enter\n`);

                const inputPromise = context.bus.waitFor("input:provided", {
                    filter: (envelope) =>
                        envelope.payload.runId === context.runId && envelope.payload.field === "apiKey",
                    timeout: 120_000,
                });

                await context.publish("input:requested", {
                    field: "apiKey",
                    prompt: "Enter API key",
                    runId: context.runId,
                });

                // Race the input vs the abort signal so cancellation breaks the wait.
                const abortPromise = new Promise<never>((_, reject) => {
                    context.signal.addEventListener(
                        "abort",
                        () => reject(new Error("Flow cancelled while waiting for input")),
                        { once: true }
                    );
                });

                const envelope = await Promise.race([inputPromise, abortPromise]);
                context.state.set("apiKey", envelope.payload.value);
                context.state.patch({ steps: [...context.state.get("steps"), "credentials-received"] });
                context.log.info(`API key received: ${envelope.payload.value.slice(0, 4)}****`);
            },
        }),

        task({
            name: "validate",
            run: async (context) => {
                context.log.info("validating credentials");
                await simulateWork(400, context.signal);
                context.state.set("validated", true);
                context.state.patch({ steps: [...context.state.get("steps"), "validate"] });
            },
        }),

        task({
            name: "import",
            run: async (context) => {
                context.log.info("importing records");
                for (let batch = 1; batch <= 3; batch++) {
                    await simulateWork(600, context.signal);
                    const imported = batch * 100;
                    context.state.set("recordsImported", imported);
                    context.log.info(`batch ${batch}/3 imported (${imported} records)`);
                }
                context.state.patch({ steps: [...context.state.get("steps"), "import"] });
            },
        }),

        task({
            name: "finalize",
            run: async (context) => {
                context.log.info("finalizing");
                await simulateWork(300, context.signal);
                context.state.patch({ steps: [...context.state.get("steps"), "finalize"] });
            },
        }),
    ],
});

// ── Terminal Controls ───────────────────────────────────────────────

function printControls(): void {
    log("");
    log(colorize("dim", "Controls: p=pause  r=resume  c=cancel  s=status  q=quit"));
    log(colorize("dim", "When prompted, type your input and press Enter"));
    log("");
}

function cleanupTerminal(): void {
    if (process.stdin.isTTY) {
        try {
            process.stdin.setRawMode(false);
            process.stdin.pause();
        } catch {
            // ignore cleanup errors
        }
    }
}

interface KeypressKey {
    ctrl?: boolean;
    name?: string;
    sequence?: string;
}

interface InputBufferState {
    buffer: string;
    waiting: boolean;
}

interface ControlTarget {
    cancel(reason: string): void;
    pause(): void;
    resume(): void;
    status(): string;
}

async function handleBufferedInputKey(
    key: KeypressKey,
    state: InputBufferState,
    submit: (value: string) => Promise<void>
): Promise<void> {
    if (key.name === "return") {
        const value = state.buffer.trim();
        if (value.length > 0) {
            state.waiting = false;
            process.stdin.setRawMode(true);
            log("");
            await submit(value);
        }
        return;
    }
    if (key.name === "backspace") {
        state.buffer = state.buffer.slice(0, -1);
        process.stdout.write(`\r\x1b[K> ${state.buffer}`);
        return;
    }
    if (key.sequence && !key.ctrl) {
        state.buffer += key.sequence;
        process.stdout.write(key.sequence);
    }
}

function handleControlKey(key: KeypressKey, target: ControlTarget): void {
    switch (key.name) {
        case "p":
            log(`  ${colorize("yellow", "PAUSING")}`);
            target.pause();
            return;
        case "r":
            log(`  ${colorize("green", "RESUMING")}`);
            target.resume();
            return;
        case "c":
            log(`  ${colorize("red", "CANCELLING")}`);
            target.cancel("Cancelled from CLI");
            return;
        case "s":
            log(`  ${colorize("dim", `status: ${target.status()}`)}`);
            return;
        case "q":
            log(`  ${colorize("red", "QUITTING")}`);
            target.cancel("Quit from CLI");
            return;
        default:
            if (key.ctrl && key.name === "c") {
                target.cancel("SIGINT");
            }
    }
}

// ── Run ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const interactive = process.stdin.isTTY ?? false;

    // Non-interactive fallback: auto-provide a fake key so the demo still completes.
    if (!interactive) {
        log("Running in non-interactive mode - controls disabled.");
        engine.bus.subscribe("input:requested", async (envelope) => {
            await input.provideInput(envelope.payload.field, envelope.payload.runId, "demo-api-key");
        });
        const result = await engine.run(importPipeline);
        log(`\nResult: ${result.status}`);
        return;
    }

    printControls();

    const handle = await engine.start(importPipeline);
    log(`Run ID: ${colorize("dim", handle.runId)}\n`);

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const inputState: InputBufferState = { buffer: "", waiting: false };

    // Switch to line-buffered input only while a task is waiting for the user.
    engine.bus.subscribe("input:requested", () => {
        inputState.waiting = true;
        inputState.buffer = "";
        process.stdin.setRawMode(false);
    });

    process.stdin.on("keypress", async (_character: string | undefined, key: KeypressKey | undefined) => {
        if (!key) {
            return;
        }
        if (inputState.waiting) {
            await handleBufferedInputKey(key, inputState, async (value) => {
                await input.provideInput("apiKey", handle.runId, value);
            });
            return;
        }
        handleControlKey(key, handle);
    });

    const result = await handle.join();
    cleanupTerminal();

    log("\n--- Result ---");
    log(`status: ${result.status}`);
    log(`duration: ${result.duration}ms`);
    log(`steps: ${result.state.steps.join(" -> ")}`);

    if (result.status === "success") {
        log(`records: ${result.state.recordsImported}`);
        log(`validated: ${result.state.validated}`);
    }
    if (result.status === "cancelled") {
        log(`reason: ${result.reason}`);
    }
}

main().catch((error) => {
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));
    cleanupTerminal();
    process.exit(1);
});
