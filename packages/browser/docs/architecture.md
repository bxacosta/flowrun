# FlowRun — Architecture

## 1. Purpose & Design Goals

FlowRun is a typed orchestrator for **tree-shaped workflows**. A flow is a tree of nodes (`task`, `parallel`, `every`) executed in
declared order over a shared state store, emitting events on a typed bus, optionally enriched by extensions that inject dependencies and
events.

Designed for backend automation and long-running jobs (browser automation was the seed use case). Goals:

- **Library-first**: no global state, no singletons, no transport coupling. I/O ownership belongs to the caller.
- **Typed end-to-end**: params, state, provided dependencies, and event payloads are statically tracked from `define.scope` to handler
  contexts and through `engine.use(...)` chains.
- **Resumable & controllable**: pause/resume at node boundaries, cooperative cancellation through `AbortSignal`, per-branch state forks,
  per-task retries with backoff.
- **Composable**: parallel/every can nest arbitrarily; extensions and modules stack additively without runtime singletons.

## 2. Module Layout

Flat `src/` layout, **tier-ordered**: each module imports only from lower tiers, no cycles. Types co-locate with the logic that owns
them — no central `types.ts`.

| Tier | File             | Role                                                                      |
|------|------------------|---------------------------------------------------------------------------|
| 0    | `utils.ts`       | Tiny type utilities (`MaybePromise`, `EmptyObject`, merge helpers).       |
| 0    | `errors.ts`      | Error hierarchy rooted at `FlowEngineError`, `normalizeError`.            |
| 1    | `events.ts`      | Event payloads, envelopes, system event schemas, merge type helpers.      |
| 1    | `signal.ts`      | `PauseGate`, linked child controllers, abort-aware sleep.                 |
| 1    | `concurrency.ts` | Branch pool executors (fail-fast / continue).                             |
| 2    | `scope.ts`       | `Scope`, `ScopeContract`, `IterationScope`, `WithProvided`.               |
| 2    | `middleware.ts`  | `Middleware<TContext>` + onion `compose`.                                 |
| 3    | `validation.ts`  | `assertPlainObject`, `assertUniqueNodeNames`.                             |
| 3    | `state.ts`       | `FlowStateStore`, fork/merge, `MergeStrategy`.                            |
| 3    | `event-bus.ts`   | `InternalBus` + `ReadableBus`/`PublishableBus` projections.               |
| 3    | `logger.ts`      | Thin logger emitting `log` events through the bus.                        |
| 4    | `node.ts`        | `NodeDefinition` IR (`task` / `parallel` / `every`), `TaskResult`.        |
| 5    | `context.ts`     | Runtime / execution context + per-node context builders.                  |
| 5    | `extension.ts`   | Extension definition, event visibility markers (`event.public/internal`). |
| 5    | `module.ts`      | Module definition (bundle of extensions + flows).                         |
| 6    | `execute.ts`     | `executeNodes` + executors for task/parallel/every, retry, fork merge.    |
| 6    | `flow-runner.ts` | `FlowDefinition`, `FlowHandle`, `FlowResult`, `startFlow` pipeline.       |
| 7    | `define.ts`      | `define.{scope,task,parallel,every,flow,extension,module}` factories.     |
| 7    | `engine.ts`      | `createEngine`, `Engine` with typed `use/register/run/start`.             |
| 8    | `index.ts`       | Narrow public re-exports.                                                 |

## 3. Type System

### 3.1 Scope — the single generic

`Scope<TProvided, TParams, TState, TPublicEvents, TAllEvents, TIteration>` threads all per-flow type info through the engine. Every
helper takes one `TScope` parameter and reads `TScope["_provided"]`, `TScope["_params"]`, etc. via indexed access. Each slot is a
phantom (`readonly _provided: TProvided`, …) — the value never exists at runtime. Defaults use `EmptyObject = Record<never, never>` so
unconstrained generics don't leak keys.

Two derivations layer over an existing scope:

- `IterationScope<TScope, TItem>` — overlays `_iteration: IterationContext<TItem>`. Used for children of `every`.
- `WithProvided<TScope, TLocal>` — merges extra `provide` keys into `_provided`. Used for `parallel`/`every` children when the container
  declares `provide`.

### 3.2 ScopeContract — user-facing declaration

The 6-positional `Scope` is verbose to write. Users declare a `ScopeContract`:

```ts
interface ScopeContract {
    events?: object;
    internalEvents?: object;
    params?: object;
    provided?: object;
    state?: object;
}
```

`ScopeFromContract<TContract>` injects `SystemPublicEvents`/`SystemEvents` into the system slots, defaults omitted fields to
`EmptyObject`, and produces the engine-internal `Scope`. `define.scope<TContract>()` returns a `ScopedDefine` exposing
`task`/`parallel`/`every`/`flow` factories pre-typed against the resolved scope — one declaration site per flow file.

### 3.3 Config shapes

User-facing configs follow `{ name, ...body }`. Containers use overload-based discrimination between provide and no-provide variants:

- `TaskConfig<TScope>` — `{ name, run, middleware?, retry?, onError? }`.
- `ParallelConfig<TScope>` — `{ name, nodes, merge?, onError? }`.
- `ParallelConfigWithResource<TScope, TLocal>` — adds `resource: { provide(context, meta) → TLocal, cleanup? }`. Children see
  `WithProvided<TScope, TLocal>`.
- `EveryConfig<TScope, TItem>` — adds `items`, `concurrency?`. Children see `IterationScope<TScope, TItem>`.
- `EveryConfigWithResource<TScope, TItem, TLocal>` — both overlays compose: `WithProvided<IterationScope<TScope, TItem>, TLocal>`.
- `FlowConfig<TScope>` — `{ name, nodes, middleware?, state? }` (`state` is required only when `TState` is non-empty, enforced by
  `FlowStateFieldOf`).
- `ExtensionConfig<TDefs, TProvided>` — `{ name, events?, resource: { provide, cleanup? } }`.
- `ModuleConfig<TExtensions, TFlows>` — `{ name, extensions?, flows? }`.

User-shaped configs are normalized into the runtime IR `NodeDefinition`
(`TaskNodeDefinition | ParallelNodeDefinition | EveryNodeDefinition`) — the discriminated union actually walked at execution time.

### 3.4 NodesSpec

```ts
NodesSpec<TScope> = readonly Node<TScope>[] | ((nodes: NodeFactory<TScope>) => readonly Node<TScope>[])
```

Two equivalent forms: a pre-built array, or a callback that receives a destructurable `{ task, parallel, every }` factory typed for the
current sub-scope. The callback form is what lets children of `every` get `IterationScope` automatically — users never spell that out.

### 3.5 Type-erased aliases

`Any*` boundary types co-locate with their typed counterpart (`AnyMiddleware` in `middleware.ts` next to `Middleware`, `AnyScope` in
`scope.ts`, etc.). Each alias carries a single `biome-ignore noExplicitAny` suppression and a short reason. The discoverability rule:
"where does `X` live?" → "next to `Any X`". Internal storage uses these; type safety is restored at the public-API boundary by the typed
wrappers.

### 3.6 MaybePromise

`MaybePromise<T> = T | Promise<T>` is the canonical "sync or async" return type for handlers, middleware, `provide`/`cleanup`, event
handlers. Used uniformly so user code is never forced into `async` just to satisfy a signature.

## 4. Flow Lifecycle

### 4.1 Engine surface

```
createEngine(config?)                                  → Engine
Engine.use(extension | module)                         → Engine'        (widens types, returns same instance)
Engine.register(flow)                                  → Flow           (registers + returns typed runnable)
Engine.flow(name)                                      → Flow           (by-name lookup, throws FlowNotRegisteredError)
Engine.flows()                                         → readonly string[]
Engine.run(flow, params?)                              → FlowResult     (ad-hoc, no enrollment)
Engine.start(flow, params?)                            → FlowHandle     (ad-hoc, returns handle)
Engine.bus                                             → ReadableBus<TAllEvents>
Flow.{name, run(params?), start(params?)}
FlowHandle.{runId, flowName, status, join, pause, resume, cancel}
```

Roles of the four execution-related methods:

- `register(flow)` — enrolls in the by-name registry **and** returns a fully-typed handle. Constrained by `CompatibleFlow<TProvided,
  TScope>`: TS rejects flows whose `_provided` is not satisfied by the engine's accumulated provided.
- `flow(name)` — by-name lookup. Returns a type-erased `Flow<Record<string, unknown>, …>` (name lookup can't recover the original scope).
  Designed for worker/dashboard paths where the flow name arrives at runtime.
- `run(flow, params?)` / `start(flow, params?)` — typed shortcuts. Equivalent to `createRunnable(flow).run/start(params)`. Do **not**
  enroll.

`Flow.run` is sugar for `Flow.start(...).join()`. Same relationship at the engine level.

### 4.2 `startFlow` pipeline

```
startFlow(args)
  1. assertPlainObject(params)                        // guard against arrays/functions
  2. frozenParams = Object.freeze(params)
  3. runId = crypto.randomUUID(); flowStart = Date.now()
  4. logger = createLogger(flowName, runId, bus)
  5. provideExtensions(...)                           // sequential await; on failure, cleanup reverse-order then rethrow
  6. state = createStateStore(flow.state?.(params) ?? {})
  7. publicBus = bus.narrow<...>()                    // typed projection, same instance
  8. controller = new AbortController()
  9. pauseGate = new PauseGate()
 10. runtime = { bus, flowName, log, params, provided, publicBus, runId }
 11. executionContext = { runtime, pauseGate, pathSegments: [], progress: { taskResults: [] } }
 12. pipelinePromise = runPipeline(...).then(updateStatus).finally(cleanupExtensions)
 13. return FlowHandle { runId, flowName, status, join, pause, resume, cancel }
```

`runPipeline` runs flow-level middleware around the body. The body emits `flow:started`, calls `executeNodes`, emits
`flow:ended{success|failed|cancelled}`. A `flowStarted` flag guards the `flow:ended` emission so an abort before the first publish
doesn't desync events. Cleanup runs in reverse registration order; cleanup errors are logged (re-throwing would re-enter the bus on a
torn-down flow).

### 4.3 Execution tree

```
executeNodes(siblings)                                 // sequential, awaits pauseGate + abort between each
  └─ executeNode(node) ─ dispatch by node.type
        ├─ task     ─→ executeTask     (retries, middleware, attempt events, TaskResult)
        ├─ parallel ─→ executeParallel (fork state, child controller, branches via resolveBranches)
        │                                              └─ executeNodes(branch.children) ↻
        └─ every    ─→ executeEvery    (items(), one branch per item, concurrency pool)
                                                       └─ executeNodes(item.children)   ↻
```

Containers recurse through the same `executeNode(s)` — there is no special-case "leaf-only" node type.

## 5. Node Execution

### 5.1 Task

`executeTask`:

- Computes `path = pathSegments.join("/") + "/" + node.name` for the TaskResult.
- For each attempt up to `retry.attempts ?? 1`:
  - emits `node:task:attempt:started`
  - builds `TaskContext` (extras: `attempt`, `nodeName`, optional `iteration`)
  - runs `compose(node.middleware, context, () => node.run(context))`
  - emits `node:task:attempt:ended{success|failed}`
  - on failure: checks `retryOn`, computes delay (`constant` or `exponential` with optional `jitter`, capped at `maxDelayMs`), emits
    `node:task:retried`, `sleepWithSignal`, awaits the pause gate, retries.
- After the loop: emits `node:task:ended` with terminal status.
- `onError: "skip"` swallows the failure (status: `"skipped"`); default `"fail"` rethrows.
- `context.skip(reason?)` throws a `SkipSignal` that the executor recognizes as a clean skip (not a failure).
- TaskResults always go into the parent `progress.taskResults` array for inclusion in `FlowResult.tasks`.

### 5.2 Parallel

`executeParallel`:

- Creates a child `AbortController` (parent abort propagates; cleanup detaches the listener).
- For each child node: forks the parent state store, builds an isolated `branchProgress`, wraps the branch closure in `withLocalProvided`
  to optionally inject per-branch `resource.provide` (e.g. each branch gets its own DB transaction). `resource.cleanup` runs in `finally`.
- Hands branches to `resolveBranches`, which dispatches to `executeFailFastBranches` (default) or `executeContinueBranches`. Concurrency
  is always `branches.length` (no throttling).
- After branches resolve: branch task results bubble up; `mergeForkedStores` applies the configured `MergeStrategy`.
- Emits `node:parallel:started`/`ended`.

### 5.3 Every

`executeEvery`:

- Calls `node.items(context)` (synchronous by contract); validates it's an array (else `InvalidItemsError`).
- Same fork-and-resolve pattern as parallel, one branch per item. Path includes the item index: `…/nodeName/<itemIndex>/…`.
- `meta` for `resource.provide`/`resource.cleanup` is `{ index, item, nodeName }`.
- Children receive `iteration: { index, item }` typed via `IterationScope`.
- Honors `concurrency`: `Number.POSITIVE_INFINITY` ⇒ all at once, else `min(concurrency, items.length)`. Pool implemented in
  `runWithConcurrency` (N workers pull indexes from a shared counter).
- `onError: "continue"`: collects per-item errors and `failedIndexes`; only successful forks merge into parent state. `"fail"` aborts
  the child controller and rethrows the first error.

## 6. State Store

`createStateStore(initial)` validates the input is a plain object, then creates a root store. Each store holds a `Map<string, unknown>`
(`data`) and a `writtenKeys: Set<string>`.

- **Reads** cascade through the parent chain: if a key is not in `data`, ask `parent.get(key)`.
- **Writes** go only to local `data` and add the key to `writtenKeys`.
- **`getWrittenValues()`** returns clones of values for keys in `writtenKeys` only — used during merge to know which keys a fork actually
  touched.
- All reads/writes deep-clone via `structuredClone`. `snapshot()` produces a frozen merged view of self + parent chain.
- **`fork()`** returns a new store whose `data` is empty and `parent` is the current store. Forks see parent state through the cascade,
  but their writes stay local. Each fork is wrapped in `ForkEntry { label, store }` — `label` is a string (parallel branch = child node
  name) or number (every iteration = item index), used solely for error messages.

### Merge strategies

`mergeForkedStores(parent, forks, strategy)` collects each fork's written values and applies:

| Strategy    | Behavior                                                                                   | Error                     |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| `strict`    | If multiple forks wrote the same key, fail. Otherwise apply each.                          | `MergeConflictError`      |
| `overwrite` | Iterate forks in order; last writer wins per key.                                          | —                         |
| `append`    | Every fork's value for a written key must be an array; concatenate per key across forks.  | `InvalidMergeValueError`  |

Merge runs **after** branches resolve, and **only for branches whose execution succeeded** in `continue` mode (failed branches' writes
are discarded). In `fail` mode, merge runs only when all branches succeeded.

## 7. Event Bus

`createEventBus<TEvents>(config?)` returns a single `InternalBus` shared by the engine and all flows.

### Topics

Strings, colon-separated (`flow:started`, `node:task:attempt:ended`). Subscriptions match exact topics or wildcard patterns: `*` matches
one segment, `**` matches any depth. Patterns compile to RegExp. System topics use **past tense** (`started`/`ended`/`paused`/`resumed`/
`retried`) — aligns with Temporal/Step Functions/Argo and removes the imperative ambiguity of `start`/`end`.

### Source

Internal publishes carry a typed `EventSource` (`"system" | "flow" | "task" | "container" | "provide" | "cleanup" | "items" |
"logger"`). `context.publish()` accepts a free-form `source?: string` (default: the calling context's source) so user code can tag
publishes.

### Subscription APIs

- `subscribe(topic, handler, options?)` — typed exact-topic subscription.
- `on(pattern, handler, options?)` — untyped wildcard subscription.
- `waitFor(topic, options?)` — Promise resolving on first match (default 30s timeout).

Options: `filter`, `priority`, `subscriberId`, `once`. Handlers are dispatched sequentially in priority order. Handler errors are routed
to `config.onError` (or logged) — they never propagate to publishers.

### Publication

`publish(topic, payload, options?)` builds an `Envelope { id, timestamp, source, correlationId?, topic, payload }`. Optional
ring-buffer history (`bufferSize`) lets late subscribers inspect recent envelopes.

### Two views, one instance

- `ReadableBus<TAllEvents>` — subscriber view; sees all events.
- `PublishableBus<TPublicEvents, TAllEvents>` — publisher view; can only publish public-typed events.

`InternalBus.narrow<TPub, TAll>()` is a typed projection (no runtime narrowing — same instance, recast types). Used to hand the user's
task context a bus that statically refuses to publish system topics.

## 8. Extensions & Modules

### Extensions

An `ExtensionDefinition` is `{ kind: "extension", name, events?, resource: { provide, cleanup? } }`.

- `events` declares typed payloads with the `event` namespace: `event.public<T>()` for events visible to user handlers,
  `event.internal<T>()` for engine-internal events. Each marker carries a phantom `_type: T` and a `[visibility]` brand symbol.
  `ExtractPublicEvents`/`ExtractInternalEvents` walk the map and split visibility.
- `resource.provide(context) → MaybePromise<TProvided>` returns an object merged into every task/flow `context.provided`. The setup
  context exposes `bus`, `flowName`, `log`, `runId`.
- `resource.cleanup(context)` runs at flow end in reverse registration order; the cleanup context includes the previously provided keys.
- Runtime guard: `assertPlainObject` over each `resource.provide` result rejects arrays/functions before merge.

`engine.use(extension)` is fully typed: it returns
`Engine<MergeObjects<TProvided, TExt>, MergePublicEvents<…>, MergeAllEvents<…>>`. Capabilities accumulate through chained `.use()`
calls.

`define.extension({ events, resource })` is a passthrough that infers `TProvided` from `resource.provide`'s return type and splits
visibility from the events map.

### Modules

A `ModuleDefinition` is `{ kind: "module", name, extensions, flows }`, produced by `define.module(...)`. `engine.use(module)` flattens
it: extensions are registered (duplicate names throw `DuplicateExtensionError`); flows are appended to the registry (duplicates throw
`DuplicateFlowError`). The module name is informational (used in docs/telemetry; not a registry key).

Module type accumulation uses `MergeExtensionProvided`/`MergeExtensionInternalEvents`/`MergeExtensionPublicEvents` (in `define.ts`,
`UnionToIntersection`-based) to fold the module's `extensions` array into a single merged shape.

## 9. Middleware

`Middleware<TContext> = (context, next) => MaybePromise<void>`.

`compose(middlewares, context, finalHandler)` is the standard onion: each middleware can `await next()`, short-circuit by not calling
it, or wrap with `try/finally` for timing/cleanup. Re-entrant `next()` calls throw.

The same `compose` is used at flow level (`flow.middleware` wraps `executeNodes`) and at task level (`task.middleware` wraps `task.run`).
Middleware sees the full context type, preserved through `NoInfer<>` so a universal middleware stays assignable to scope-typed slots.

## 10. Pause, Cancel, Signals

### PauseGate

A gate with a waiters list: `pause()` flips a flag; `resume()` resolves all queued waiters. `waitIfPaused()` either returns immediately
(not paused) or awaits a fresh promise pushed onto the waiters list. Checked between sibling executions and between retry attempts.

Pause is **cooperative** — already-running handlers must complete before the pause takes effect. A fully preemptive pause cannot be
implemented safely over arbitrary user code; pause is therefore "pause at the next node boundary".

### Cancellation

`FlowHandle.cancel(reason?)` sets a flag, resumes any pause (so awaiting code can observe the abort), and aborts the root
`AbortController`. The pipeline distinguishes cancellation from failure by checking the flag in its catch block: cancelled runs return
`CancelledFlowResult` with the reason; uncaught errors return `FailedFlowResult`.

Cancellation only stops user code that observes `context.signal`. Robust cancellation requires user code to propagate and honor
`AbortSignal`.

### Signal tree

`createChildController(parentSignal)` produces a child controller that aborts when the parent does; the cleanup function detaches the
listener to avoid leaks. Containers create a child controller so a fail-fast inside the container can `controller.abort()` to cancel
sibling branches without aborting the whole flow. `sleepWithSignal(ms, signal)` is a cancellable timer used by retry delays.

## 11. Validation

Centralized in `validation.ts`. Defense-in-depth at API boundaries:

- **`assertPlainObject(value, message)`** — rejects arrays, functions, `null`, and prototype-modified objects. Applied to: flow params,
  flow state initial value, extension `provide()` result, container `provide()` result. Necessary because `extends object` accepts
  arrays/functions, which would silently break consumers. Throws `InvalidPlainObjectError`.
- **`assertUniqueNodeNames(nodes, parentName)`** — siblings (children of a flow / parallel / every) must have distinct names. Typed
  loosely as `readonly { name: string }[]` to keep `validation.ts` decoupled from `node.ts` (avoiding a cycle through `state.ts`). Names
  compose into the task `path`; duplicates would produce ambiguous paths and unstable event correlation. Throws
  `DuplicateNodeNameError`.

Both run eagerly at registration / startup, never deep in execution.

## 12. Naming Conventions

User-supplied identifiers always use `name`. The only `id` in the system is `runId` (system-generated UUID per execution).

- `flow.name`, `node.name`, `extension.name`, `module.name`, `branchName` (parallel branch label = child node's name), `nodeName` (in
  event payloads, distinct from `flowName` for unambiguity).
- `runId` — UUID minted by `startFlow`, propagated through every event payload, context, and result.

This tells consumers that `name` is a developer-chosen, human-meaningful label that may appear in logs and dashboards, while `runId` is
opaque correlation.

## 13. Invariants

Contracts that hold across the engine and are not obvious from any single file:

- A flow must declare at least one node.
- Siblings (children of a flow, parallel, or every) have unique `name`s.
- Flow `params` and `state` are plain objects; arrays/functions are rejected at the boundary.
- Forks see the parent store through cascade reads; writes never leave the fork until merge.
- Merge runs **only** for branches whose execution succeeded; failed branches' writes are discarded.
- `flow:ended` is emitted iff `flow:started` was emitted (guarded by the `flowStarted` flag).
- Extension `cleanup` runs in reverse registration order, regardless of pipeline outcome; cleanup errors are logged, never rethrown.
- `runId` is opaque, unique per execution, and present on every event payload and result.
- `TaskResult.path` is `parent/.../nodeName` (with `<itemIndex>` segments inside `every`) and is stable for event/result correlation.
- `Engine.flow(name)` returns a type-erased runnable; type information is only preserved through `register`/`run`/`start` with a
  statically-known definition.

## 14. Extension Points

Where to make changes when extending the engine:

- **New extension** — write a `define.extension({ name, events?, resource: { provide, cleanup? } })` and pass it to `engine.use(...)`.
  No engine code changes required.
- **Bundled feature set** — wrap related extensions and flows in `define.module({ name, extensions, flows })`. `engine.use(module)`
  flattens both into the engine.
- **New merge strategy** — extend the `MergeStrategy` union in `state.ts`, add the apply function, and dispatch from `mergeForkedStores`.
  Update the table in §6.
- **New node type** — coordinated change: add the `*NodeDefinition` interface to `node.ts`, extend the `NodeDefinition` union, add the
  config + factory to `define.ts`, add an executor in `execute.ts`, dispatch from `executeNode`. Children should recurse through
  `executeNodes` to keep recursion uniform.
- **New system event** — add the payload to `SystemInternalEvents` (or `SystemPublicEvents`) in `events.ts`, emit it from the
  appropriate executor with `{ source: "system" }`. Keep payload shape stable once exposed.
- **Custom reporter / sink** — subscribe through `engine.bus`. The engine is transport-agnostic — formatting and routing belong outside
  the library (see `examples/shared/`).

## 15. Design Decisions

**Single `Scope` generic.** Separate `TParams`/`TState`/`TProvided`/`TEvents` parameters on every helper made per-field variance
impossible and produced unreadable types. Threading via `TScope["_provided"]` etc. preserves variance at slot positions and keeps every
signature single-parameter.

**`ScopeContract` as a single declaration site.** The 6-generic `Scope` is a power tool for engine internals but too verbose at the
user surface. The Contract is named, optional-field, declarative; `define.scope<TContract>()` resolves it once and the engine internals
never see it.

**Configs use `extends object`, not `Record<string, unknown>`.** The Record constraint excludes interface declarations (interfaces have
no implicit index signature). Many users will reach for `interface` to declare state/params. Cost: arrays/functions become structurally
assignable. Mitigation: `assertPlainObject` at the entry points.

**Flat, tier-ordered module layout.** No `core/`, `execution/`, etc. With ~20 modules, nesting added navigation cost without clarifying
ownership. Tier is enforced by import direction; the tier number is emergent, not encoded in file names.

**Single bus per engine.** Every flow shares the engine bus — simpler wiring, extensions subscribe once. Per-flow filtering is the
consumer's job (filter on `flowName`/`runId`). `narrow()` provides type-safe publisher views with zero runtime cost.

**Event visibility via phantom brand.** A `[visibility]` brand symbol on the marker keeps ergonomics simple (`event.public<…>()` vs
`event.internal<…>()`) while preserving type-level extraction of public/internal splits.

**Past-tense system topics.** `started`/`ended`/`paused`/`resumed`/`retried` rather than imperatives — aligns with workflow
orchestrator conventions and frames events as "things that happened".

**Copy-on-write fork stores.** Forks need isolation (branches must not see each other's writes mid-execution) and selective merge
(only writes propagate). Storing only writes in forks + cascading reads through the parent chain delivers both at low memory cost.
`structuredClone` on every read/write trades performance for safety against accidental mutation of stored values.

**`MaybePromise` everywhere.** The library targets backend automation where most user code is async, but doesn't force it. A handler
that mutates state synchronously shouldn't need to be `async`. Same logic for middleware, `provide`/`cleanup`, event handlers.

**Containers compose recursively.** `parallel` and `every` both delegate to `executeNode(s)` for children. No leaf-only special case;
`every`-of-`parallel`-of-`task` is valid. State forks nest naturally because each container forks from its parent's store.

**Cooperative pause, signal-based cancel.** Pause is checkpointed at sibling boundaries; cancel uses `AbortSignal` so user code that
honors `context.signal` can react promptly. Neither can interrupt synchronous user code, by design.

**Engine is mutable, types accumulate.** `engine.use` mutates the engine's lists and returns the same instance with widened types. The
immutable alternative is purer but breaks the natural fluent chain at call sites. Type widening is a compile-time-only effect.

**Definitions are values, not classes.** `define.{extension,flow,module,task,parallel,every}` are passthrough factories — no classes,
no decorators, no registry side-effects. Engine registration via `use` / `register` is the only side-effecting step.

**Narrow public API.** Internal type machinery (`MergeObjects`, `MergeAllEvents`, `AsEventMap`, per-node-type `*NodeDefinition` shapes,
`InternalBus`) is not re-exported from `index.ts`. Users get factories, runtime instance types (`Engine`, `Flow`, `FlowHandle`,
`FlowResult`), context types, error classes, and the typed bus interfaces — and nothing else.
