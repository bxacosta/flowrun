/**
 * 03-composition.ts — Composing Nodes
 *
 * A CI pipeline built bottom-up from reusable scoped pieces. The same scope
 * (`define.scope<CIContract>()`) types every node, so they compose without
 * losing access to params/state — and can live in separate files unchanged.
 *
 * Tree structure:
 *   prepare (task)                      <- task at flow level
 *   build (parallel)                    <- parallel at flow level
 *   ├─ compileAll (every: modules)      <- every inside parallel
 *   │  └─ compile (task)                <- task inside every
 *   └─ runLinters (parallel)            <- parallel inside parallel
 *      ├─ lintTypes (task)              <- task inside parallel
 *      └─ lintStyle (task)
 *   deploy (every: environments)        <- every at flow level
 *   └─ deployEnv (parallel)             <- parallel inside every
 *      ├─ deployServer (task)
 *      └─ smokeTest (task)
 *
 * Each leaf writes a disjoint state key with [oneEntry], so merge: "append"
 * concatenates contributions cleanly across forks.
 */

import { createEngine, define } from "@flowrun/core";
import { delay, log, title } from "./shared/helpers.ts";

// ── Shared contract & state ─────────────────────────────────────────

interface CIContract {
    state: CIState;
}

interface CIState {
    compiled: string[];
    deployments: string[];
    environments: string[];
    lintReport: string[];
    modules: string[];
    smokeTests: string[];
}

const ci = define.scope<CIContract>();

const initialCIState = (): CIState => ({
    compiled: [],
    deployments: [],
    environments: ["staging", "production"],
    lintReport: [],
    modules: ["auth", "api", "ui"],
    smokeTests: [],
});

// ─────────────────────────────────────────────────────────────────────
// Leaf and container nodes — built bottom-up, each typed by `ci`
// ─────────────────────────────────────────────────────────────────────

const prepare = ci.task({
    name: "prepare",
    run: (context) => {
        context.log.info("preparing build");
    },
});

// every inside the build parallel — fans out per module
const compileAll = ci.every({
    name: "compileAll",
    items: (context) => context.state.get("modules"),
    concurrency: 2,
    merge: "append",
    nodes: ({ task }) => [
        task({
            name: "compile",
            run: async (context) => {
                await delay(5);
                context.state.set("compiled", [`compile:${context.iteration.item}`]);
            },
        }),
    ],
});

// parallel inside the build parallel — sibling linters
const runLinters = ci.parallel({
    name: "runLinters",
    merge: "append",
    nodes: ({ task }) => [
        task({
            name: "lintTypes",
            run: (context) => {
                context.state.set("lintReport", ["types"]);
            },
        }),
        task({
            name: "lintStyle",
            run: (context) => {
                context.state.set("lintReport", ["style"]);
            },
        }),
    ],
});

// outer parallel that runs compilation and linters concurrently
const build = ci.parallel({
    name: "build",
    nodes: [compileAll, runLinters],
});

// every iterates per environment and runs a parallel pair of tasks per env
const deploy = ci.every({
    name: "deploy",
    items: (context) => context.state.get("environments"),
    concurrency: 1,
    merge: "append",
    nodes: ({ parallel }) => [
        parallel({
            name: "deployEnv",
            merge: "append",
            nodes: ({ task }) => [
                task({
                    name: "deployServer",
                    run: async (context) => {
                        await delay(5);
                        context.state.set("deployments", [`deploy:${context.iteration.item}`]);
                    },
                }),
                task({
                    name: "smokeTest",
                    run: async (context) => {
                        await delay(5);
                        context.state.set("smokeTests", [`smoke:${context.iteration.item}`]);
                    },
                }),
            ],
        }),
    ],
});

// ── Flow assembly ───────────────────────────────────────────────────

const ciPipeline = ci.flow({
    name: "ci-pipeline",
    state: initialCIState,
    nodes: [prepare, build, deploy],
});

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();

// ── Run ─────────────────────────────────────────────────────────────

function summarize(label: string, state: CIState, durationMs: number, taskCount: number): void {
    log(`status: success (${taskCount} tasks, ${durationMs}ms)`);
    log(`  ${label} compiled:    [${state.compiled.join(", ")}]`);
    log(`  ${label} lintReport:  [${state.lintReport.join(", ")}]`);
    log(`  ${label} deployments: [${state.deployments.join(", ")}]`);
    log(`  ${label} smokeTests:  [${state.smokeTests.join(", ")}]`);
}

title("Scoped composition - CI pipeline");
const result = await engine.run(ciPipeline);
if (result.status === "success") {
    summarize("ci", result.state, result.duration, result.tasks.length);
}
