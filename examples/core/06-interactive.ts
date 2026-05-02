/**
 * 06-interactive.ts — Interactive Flow with Terminal Controls
 *
 * Covers:
 *  - flow.start() → FlowHandle (non-blocking execution)
 *  - Keyboard controls: pause, resume, cancel, status
 *  - Human-in-the-loop: a task that waits for user input via bus.waitFor()
 *  - Cooperative cancellation with context.signal
 *  - Console subscriber for live event visibility
 *
 * Run: bun run examples/06-interactive.ts
 */

import { emitKeypressEvents } from "node:readline";
import { createEngine, defineExtension, event } from "@flowrun/core"
import { subscriber } from "./shared/subscriber.ts";
import { colorize, log, simulateWork } from "./shared/helpers.ts";

// ── Human-in-the-loop extension ─────────────────────────────────────
//
// The extension captures the PublishableBus in create() and exposes a
// provideInput() method so external code (CLI, dashboard) can publish
// input:provided events without needing direct bus access.

function createInputExtension() {
    let publishInput: ((field: string, runId: string, value: string) => Promise<void>) | null = null;

    const extension = defineExtension({
        name: "input",
        events: {
            "input:requested": event<{ field: string; prompt: string; runId: string }>(),
            "input:provided": event<{ field: string; runId: string; value: string }>(),
        },
        create(context) {
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

// ── Engine ──────────────────────────────────────────────────────────

const input = createInputExtension();
const engine = createEngine({ bufferSize: 100 }).extend(input.extension);
subscriber(engine.bus);

// ── Flow: data import pipeline with human-in-the-loop ───────────────

const importPipeline = engine.flow({
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
            handler: async (context) => {
                context.log.info("preparing import environment");
                await simulateWork(500, context.signal);
                context.state.set("steps", ["prepare"]);
            },
        }),

        // Human-in-the-loop: waits for user to provide API key
        task({
            name: "request-credentials",
            handler: async (context) => {
                log(`\n  ${colorize("yellow", "INPUT REQUIRED")}  Type your API key and press Enter\n`);

                context.publish("input:requested", {
                    field: "apiKey",
                    prompt: "Enter API key",
                    runId: context.runId,
                });

                const inputPromise = context.bus.waitFor("input:provided", {
                    filter: (envelope) =>
                        envelope.payload.runId === context.runId && envelope.payload.field === "apiKey",
                    timeout: 120_000,
                });

                const abortPromise = new Promise<never>((_, reject) => {
                    context.signal.addEventListener("abort", () =>
                        reject(new Error("Flow cancelled while waiting for input")),
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
            handler: async (context) => {
                context.log.info("validating credentials");
                await simulateWork(400, context.signal);
                context.state.set("validated", true);
                context.state.patch({ steps: [...context.state.get("steps"), "validate"] });
            },
        }),

        task({
            name: "import",
            handler: async (context) => {
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
            handler: async (context) => {
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

async function main(): Promise<void> {
    const interactive = process.stdin.isTTY ?? false;

    if (!interactive) {
        log("Running in non-interactive mode — controls disabled.");
        const result = await importPipeline.run();
        log(`\nResult: ${result.status}`);
        return;
    }

    printControls();

    const handle = await importPipeline.start();
    log(`Run ID: ${colorize("dim", handle.runId)}\n`);

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let inputBuffer = "";
    let waitingForInput = false;

    engine.bus.subscribe("input:requested", () => {
        waitingForInput = true;
        inputBuffer = "";
        process.stdin.setRawMode(false);
    });

    process.stdin.on("keypress", async (_character: string | undefined, key: { name?: string; ctrl?: boolean; sequence?: string } | undefined) => {
        if (!key) return;

        if (waitingForInput) {
            if (key.name === "return") {
                const value = inputBuffer.trim();
                if (value.length > 0) {
                    waitingForInput = false;
                    process.stdin.setRawMode(true);
                    log("");

                    await input.provideInput("apiKey", handle.runId, value);
                }
            } else if (key.name === "backspace") {
                inputBuffer = inputBuffer.slice(0, -1);
                process.stdout.write(`\r\x1b[K> ${inputBuffer}`);
            } else if (key.sequence && !key.ctrl) {
                inputBuffer += key.sequence;
                process.stdout.write(key.sequence);
            }
            return;
        }

        switch (key.name) {
            case "p":
                log(`  ${colorize("yellow", "PAUSING")}`);
                handle.pause();
                break;
            case "r":
                log(`  ${colorize("green", "RESUMING")}`);
                handle.resume();
                break;
            case "c":
                log(`  ${colorize("red", "CANCELLING")}`);
                handle.cancel("Cancelled from CLI");
                break;
            case "s":
                log(`  ${colorize("dim", `status: ${handle.status()}`)}`);
                break;
            case "q":
                log(`  ${colorize("red", "QUITTING")}`);
                handle.cancel("Quit from CLI");
                break;
            default:
                if (key.ctrl && key.name === "c") {
                    handle.cancel("SIGINT");
                }
        }
    });

    const result = await handle.join();
    cleanupTerminal();

    log(`\n--- Result ---`);
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
