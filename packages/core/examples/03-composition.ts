/**
 * 03-composition.ts — Composing Nodes
 *
 * Covers:
 *  - Nested containers: parallel inside parallel, each inside parallel, parallel inside each
 *  - Bottom-up composition: nodes built standalone with shape.task/parallel/each
 *    and assembled into a flow later
 *  - Reusable shape contract shared across every node and the final flow
 *  - merge: "append" across forks — each branch contributes its slice of state
 *
 * Tree structure:
 *   prepare (task)                      <- task at flow level
 *   build (parallel)                    <- parallel at flow level
 *   ├─ compileAll (each: modules)       <- each inside parallel
 *   │  └─ compile (task)                <- task inside each
 *   └─ runLinters (parallel)            <- parallel inside parallel
 *      ├─ lintTypes (task)              <- task inside parallel
 *      └─ lintStyle (task)
 *   deploy (each: environments)         <- each at flow level
 *   └─ deployEnv (parallel)             <- parallel inside each
 *      ├─ deployServer (task)
 *      └─ smokeTest (task)
 */

import { createEngine, shape } from "@flowrun/core";
import { delay, log, title } from "./shared/helpers.ts";

// ── Shared shape & state ─────────────────────────────────────────────

interface PipelineShape {
    state: PipelineState;
}

interface PipelineState {
    compiled: string[];
    deployments: string[];
    environments: string[];
    lintReport: string[];
    modules: string[];
    smokeTests: string[];
}

const pipeline = shape<PipelineShape>();

const initialState = (): PipelineState => ({
    compiled: [],
    deployments: [],
    environments: ["staging", "production"],
    lintReport: [],
    modules: ["auth", "api", "ui"],
    smokeTests: [],
});

// ── Leaf and container nodes — built bottom-up, each typed by `pipeline` ──

const prepare = pipeline.task({
    name: "prepare",
    run: (context) => {
        context.log.info("preparing");
    },
});

// each inside parallel — fans out per item
const compileAll = pipeline.each({
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

// parallel inside parallel — sibling tasks running concurrently
const runLinters = pipeline.parallel({
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

// outer parallel that runs both children concurrently
const build = pipeline.parallel({
    name: "build",
    nodes: [compileAll, runLinters],
});

// each iterates per item and runs a parallel of two tasks inside
const deploy = pipeline.each({
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

const compositionFlow = pipeline.flow("composition").state(initialState).nodes([prepare, build, deploy]);

// ── Engine ──────────────────────────────────────────────────────────

const engine = createEngine();

// ── Run ─────────────────────────────────────────────────────────────

title("Shaped composition - nested containers");
const result = await engine.run(compositionFlow);
if (result.status === "success") {
    log(`status: success (${result.tasks.length} tasks, ${result.durationMs}ms)`);
    log(`  compiled:    [${result.state.compiled.join(", ")}]`);
    log(`  lintReport:  [${result.state.lintReport.join(", ")}]`);
    log(`  deployments: [${result.state.deployments.join(", ")}]`);
    log(`  smokeTests:  [${result.state.smokeTests.join(", ")}]`);
}
