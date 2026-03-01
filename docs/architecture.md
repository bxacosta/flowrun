# Architecture

## Overview

This project implements a TypeScript flow engine for orchestrating typed execution graphs. A flow is defined as a tree
of nodes composed from `step`, `sequence`, and `parallel`. Execution is stateful, event-driven, and cooperative with
respect to cancellation and pause boundaries.

The public API is exported from `src/index.ts`. The runtime implementation is concentrated in `src/core/`.

## Design Goals

- Provide a compact public API centered on flow composition.
- Keep execution contracts explicit and predictable.
- Preserve strong typing for parameters, state, middleware, and hooks.
- Support retries, timeouts, cancellation, pause/resume, and reporting without exposing internal engine details.
- Keep the engine extensible through events, middleware, merge strategies, and custom reporters.

## Module Structure

- `src/core/types.ts`: public and internal type contracts.
- `src/core/composability.ts`: builders for `step`, `sequence`, `parallel`, and `defineFlow`.
- `src/core/engine.ts`: execution engine and run lifecycle management.
- `src/core/context.ts`: flow and step context construction.
- `src/core/state.ts`: in-memory state store and parallel merge logic.
- `src/core/middleware.ts`: middleware composition.
- `src/core/retry.ts`: retry delay computation, linked abort propagation, and timeout helpers.
- `src/core/events.ts`: event contracts emitted by the engine.
- `src/core/reporter.ts`: reporter abstraction and reporter composition.
- `src/core/logger.ts`: logger facade backed by engine events.
- `src/core/errors.ts`: domain-specific runtime errors.

## Execution Model

### Flow Definition

A flow is described by `FlowDefinition<TParams, TState>`.

Key properties:

- `id`, `name`
- `initialState`
- `middleware`
- `steps`
- `onStart`, `onSuccess`, `onFailure`, `onComplete`

Two declaration styles are supported:

- direct `steps` array
- `build(builder)` callback that receives `step`, `sequence`, and `parallel`

`defineFlow` rejects flows without nodes.

### Node Types

- `step`: executable unit
- `sequence`: ordered child execution
- `parallel`: concurrent child execution with configurable concurrency, failure mode, and merge strategy

The engine executes any flow as a recursive traversal over `FlowNode`.

### Step Contract

A step handler has the signature:

```ts
(context: StepContext<TParams, TState>) => MaybePromise<void>
```

The step does not return output directly. State mutation is explicit through `context.state`.

## Context Model

### FlowContext

`FlowContext` is shared at the flow level and exposes:

- `flow`
- `runId`
- `params`
- `state`
- `signal`
- `log`
- `stop(reason?)`

`stop()` throws `FlowStopSignal`. This provides early completion without treating the condition as a failure.

### StepContext

`StepContext` extends `FlowContext` with:

- `step`
- `attempt`

`createStepContext()` also creates a step-scoped logger that enriches emitted log events with step metadata.

### Branch Context

`createBranchFlowContext()` is used by `parallel` nodes. Each branch receives:

- the same flow metadata and params
- a forked state store
- a linked abort signal
- a branch-local logger

This isolates branch state until merge time.

## State Model

### MemoryStateStore

`MemoryStateStore` is the default runtime store.

Supported operations:

- `get`
- `set`
- `has`
- `patch`
- `snapshot`

Additional internal helpers:

- `fork()`
- `changes()`

### Cloning Strategy

`structuredClone` is used in the store constructor and on write/read boundaries.

This design was selected for three reasons:

- branch isolation in `parallel`
- stable snapshots for results and hooks
- protection against shared nested references across forks

The engine therefore assumes that runtime state is structured-clone compatible.

## Parallel Execution

### Execution Semantics

`parallel` executes child nodes concurrently up to `concurrency`.

Failure mode is controlled by `mode`:

- `fail-fast`: stop scheduling additional branch work after the first failure
- `all-settled`: wait for all branches and surface failures after completion

Each branch executes against a forked `MemoryStateStore`. After all branches complete, branch patches are merged into
the parent state.

### Merge Strategies

`parallel` accepts `merge` configuration through `ParallelMergeConfig<TState>`.

Supported strategies:

- `strict`
    - default behavior
    - allows identical values for the same key
    - throws `ParallelMergeError` on conflicting writes
- `overwrite`
    - keeps the last observed branch value for a conflicting key
- `arrays`
    - concatenates values when all conflicting values are arrays
    - throws for non-array conflicts
- `custom`
    - delegates conflict resolution to a user-supplied resolver

`strict` remains the default to avoid silent state corruption.

`arrays` exists for common aggregation cases such as logs, audit entries, or collected results. The narrower name was
selected to reflect the exact behavior; it is not a general append operation.

### Merge Implementation Notes

The engine collects branch patches through `MemoryStateStore.changes()` and merges them with `mergeBranchChanges()`.

Conflict resolution occurs per key after branch execution completes. The merge phase does not observe temporal ordering
inside branches beyond the final patch values.

## Retry and Timeout Model

### Retry

Retry policy is configured per step through `RetryPolicy`.

Supported fields:

- `attempts`
- `delayMs`
- `strategy`: `constant` or `exponential`
- `maxDelayMs`

Delay computation is handled by `computeRetryDelay()`.

### Timeout

Timeout is configured per step through `timeoutMs`.

The engine wraps step execution with `runWithTimeout()`. On timeout:

- the step attempt abort controller is aborted
- `StepTimeoutError` is raised
- normal error handling continues through retry and `onError`

## Error Handling Model

### Step-Level Error Handling

`StepOptions.onError` accepts:

- `"fail"`
- `"skip"`
- custom resolver `(error, context, meta) => "fail" | "skip"`

Behavior:

- `fail`: the flow fails
- `skip`: the step attempt is recorded as skipped and execution continues
- custom resolver: computes one of the previous outcomes

Step mutations performed before the error are preserved. No transactional rollback is implemented.

### Flow-Level Error Handling

Hooks:

- `onFailure` runs only when the flow fails
- `onSuccess` runs when the flow completes successfully, including `stop()`-based completion
- `onComplete` runs for every terminal state

Hook failures are logged and ignored. They do not change the final run status.

## Run Lifecycle

### Registration and Startup

`FlowEngine` supports two execution paths:

- `register(flow)` followed by `run(id, params)`
- `run(flow, params)` without registration

`start()` creates a run handle immediately and begins execution asynchronously.

### RunHandle

`FlowHandle` exposes:

- `status()`
- `join()`
- `cancel(reason?)`
- `pause()`
- `resume()`

### Final Result Semantics

`RunResult` contains:

- flow identifiers
- terminal status
- final state snapshot
- total duration
- aggregated step results
- terminal error data

`RunResult` is built after `onSuccess` and again after `onComplete`. This ensures that `result.state` reflects the
actual final state visible at the end of the run.

## Pause and Cancel Semantics

### Pause

Pause is boundary-based.

Behavior:

- `pause()` requests a transition into paused state
- the engine pauses before the next node is executed
- an already running step is not interrupted

This behavior is intentional. A fully preemptive pause mechanism cannot be implemented safely for arbitrary user code
because step bodies may perform synchronous work, external I/O, or non-cooperative async operations.

`pause()` should therefore be interpreted as `pause at the next execution boundary`.

### Cancel

Cancellation is cooperative and signal-based.

Behavior:

- `cancel()` aborts the run controller
- linked branch and step controllers receive the abort signal
- cancellation only stops user code that observes `context.signal`

This is also intentional. The engine cannot forcefully terminate arbitrary JavaScript execution. Robust cancellation
requires user code to propagate and honor `AbortSignal`.

## Event Model

The engine emits typed runtime events through the configured reporter.

Supported event kinds:

- `flow:start`
- `flow:end`
- `step:start`
- `step:retry`
- `step:end`
- `log`

### Step Event Semantics

Step events are attempt-oriented.

- `step:start`: emitted for every attempt
- `step:end`: emitted for every attempt with `status`, `attempt`, and `attempts`
- `step:retry`: emitted only when another attempt will be scheduled

This model was selected over a separate `step:attempt:*` hierarchy to reduce event duplication and simplify tracing.
Full retry traces can be reconstructed from `step:start`, `step:end`, and `step:retry` alone.

### Logging

`context.log` is implemented on top of the reporter. Log messages become `log` events enriched with flow and optional
step metadata.

This keeps logging transport-independent and allows custom reporters to route or format logs without coupling
application code to console output.

## Middleware Model

Middleware is composed with `compose()` using a standard onion model.

Order of execution:

- outer middleware before inner middleware
- core step handler
- inner middleware after core
- outer middleware after inner

Middleware can short-circuit execution by not calling `next()`.

Flow middleware and step middleware are concatenated for each step execution.

## Reporter Model

The engine depends only on the `Reporter` interface:

```ts
interface Reporter {
    report(event: EngineEvent): void;
}
```

Built-in implementations:

- `NoopReporter`
- `CompositeReporter`

Console reporting is implemented in `examples/shared/reporter.ts`, not in the library. This keeps the library
transport-agnostic and prevents coupling the public API to one presentation format.

## Important Invariants

- A flow must declare at least one node.
- Registered flow identifiers must be unique per engine instance.
- Parallel branches operate on isolated state forks.
- `RunResult.state` is a final snapshot, not a live store.
- Step retries are recorded as one aggregated `StepRunResult` entry with total step duration and final attempt count.
- `step:start` and `step:end` describe attempt execution, not only logical step entry and exit.

## Extension Points

### Add a New Reporter

Implement `Reporter` and pass it into `FlowEngine`.

`CompositeReporter` can be used to fan out events to multiple sinks.

### Add a New Merge Strategy

Current merge behavior is centralized in `mergeBranchChanges()`.

To add another built-in strategy:

- extend `ParallelMergeMode`
- update `mergeBranchChanges()`
- update tests and examples

### Add New Node Types

This requires coordinated changes in:

- `FlowNode` union
- builder contracts in `types.ts`
- constructor helpers in `composability.ts`
- dispatch logic in `FlowEngine.executeNode()`

The current design keeps node dispatch centralized to make this extension predictable.

### Add New Event Types

New events require coordinated changes in:

- `events.ts`
- engine emission points
- reporter implementations
- public exports

The event model should remain semantically minimal. New event types should only be added when existing event payloads
cannot represent the required lifecycle detail.

## Constraints and Trade-Offs

- State must be structured-clone compatible.
- Pause and cancel are cooperative by design.
- Hook failures are non-fatal by design.
- Parallel merge behavior is explicit and strategy-based instead of implicit.
- Step results are aggregated at the logical step level, while events are attempt-oriented.

## Recommended Modification Guidelines

- Preserve the distinction between public API contracts in `types.ts` and execution logic in `engine.ts`.
- Keep state semantics explicit; avoid introducing implicit return-value merges for steps.
- Keep event names and payloads stable once exposed publicly.
- Treat pause and cancel as cooperative mechanisms unless a strictly narrower execution model is introduced.
- Extend merge behavior cautiously. Silent conflict resolution should remain opt-in.
