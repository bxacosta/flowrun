import * as readline from "node:readline";
import { FlowEngine } from "../../src";
import { ConsoleReporter } from "../shared/reporter.ts";
import { cliImportFlow } from "./flow.ts";

function printControls(): void {
    console.log("");
    console.log("CLI Import Demo");
    console.log("----------------------------------------");
    console.log("p -> pause");
    console.log("r -> resume");
    console.log("c -> cancel");
    console.log("s -> status");
    console.log("q -> quit and cancel");
    console.log("----------------------------------------");
    console.log("");
}

async function main(): Promise<void> {
    const interactive = process.stdin.isTTY;
    const engine = new FlowEngine({
        reporter: new ConsoleReporter(),
    });

    const handle = engine.start(cliImportFlow, {
        source: "local-cli",
        interactive,
    });

    console.log(`Run ID: ${handle.runId}`);

    if (interactive) {
        printControls();
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on("keypress", async (_character, key) => {
            if (!key) {
                return;
            }

            switch (key.name) {
                case "p":
                    console.log("\nPausing run...\n");
                    await handle.pause();
                    break;
                case "r":
                    console.log("\nResuming run...\n");
                    await handle.resume();
                    break;
                case "c":
                    console.log("\nCancelling run...\n");
                    await handle.cancel("Cancelled from CLI");
                    break;
                case "s":
                    console.log(`\nCurrent status: ${handle.status()}\n`);
                    break;
                case "q":
                    console.log("\nExiting and cancelling run...\n");
                    await handle.cancel("Quit from CLI");
                    break;
                default:
                    if (key.ctrl && key.name === "c") {
                        await handle.cancel("SIGINT");
                    }
            }
        });
    } else {
        console.log("Running in non-interactive mode; CLI controls are disabled.");
    }

    const result = await handle.join();

    console.log("\nRun result:");
    console.log({
        status: result.status,
        durationMs: result.durationMs,
        stepCount: result.steps.length,
        state: result.state,
    });

    if (interactive && process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
    }
}

main().catch((error) => {
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));

    if (process.stdin.isTTY) {
        try {
            process.stdin.setRawMode(false);
            process.stdin.pause();
        } catch {
            // ignore cleanup errors
        }
    }

    process.exit(1);
});
