# `@flowrun/browser` — Specification

> A flow management layer for browser automation built on top of
> `@flowrun/core` and Playwright. The package is intentionally a thin
> orchestration layer: it gives you per-run session lifecycle, per-branch
> page/session provisioning, selector decoupling, storage abstraction,
> tracing, and observability around Playwright primitives. **It is not a
> wrapper around Playwright actions.** Tasks use the native Playwright
> `Page`, `Locator`, and `BrowserContext` APIs directly. The tight coupling
> to Playwright is an explicit, accepted design tradeoff.

---

## 1. Goals and non-goals

### Goals

- A small, focused public API: define a browser flow, run it, get a result.
- Three pluggable contracts (`BrowserProvider`, `SelectorRegistry`,
  `StorageProvider`) so the same flow code runs against local Chrome, a
  remote CDP service, file-based or cloud storage, JSON or DB-backed
  selectors. The user picks implementations at engine construction.
- One reference implementation per contract shipped in v1
  (`LocalBrowserProvider`, `JsonSelectorRegistry`, `FileStorageProvider`).
- Per-branch and per-iteration page or session provisioning out of the
  box, with the user choosing between shared session (multi-tab) and
  isolated session (multi-account), without writing the wiring themselves.
- First-class tracing integration: Playwright traces saved via
  `StorageProvider` based on flow outcome, with no extra task code.
- Observability bridging: Playwright's `pageerror`/`console-error` events
  surface on the bus so flows can be debugged from event logs.
- The user imports from `@flowrun/browser` only. The core is a transitive
  detail, not a learning curve.

### Non-goals

- **Wrappers around Playwright actions.** No `ctx.click`, `ctx.fill`,
  `ctx.screenshot`, `ctx.waitFor`, `ctx.download`. Tasks call
  `ctx.page.click(...)`, `ctx.page.fill(...)` and the rest of the
  Playwright API natively. The package adds orchestration value, not API
  surface duplication. The single exception is `ctx.navigate`, which
  exists purely for the observability and typed-error value (see section
  7) and is opt-in — `ctx.page.goto(...)` remains available.
- Multi-driver abstraction. The package is built on Playwright. If a flow
  needs Puppeteer, that is a separate package, not a config switch here.
- Mid-task preemptive cancellation in the strict sense. The package
  installs an `AbortSignal` listener that closes the browser context when
  the run is cancelled (see section 11), which causes pending Playwright
  operations to reject promptly, but it does not require cooperation from
  user task code beyond honouring the resulting error.
- Selectors with compile-time type safety on keys. Lookup is string-based
  with runtime errors on missing keys in v1. A typed-keys API
  (`defineSelectors({...})`) is on the roadmap for v2 and is compatible
  with the v1 contract.
- Pooled browser providers. Documented as an extension path but not
  shipped in v1.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User flow code                           │
│   (uses native Playwright Page/Locator/BrowserContext APIs)     │
│         imports only from @flowrun/browser                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                @flowrun/browser public API                      │
│                                                                 │
│   createBrowserEngine(config)                                   │
│   browser.flow / browser.scope / browser.extension              │
│   browser.newPage() / browser.newSession()                      │
│   Reference impls + contracts + errors                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ uses
┌──────────────────────────▼──────────────────────────────────────┐
│                 Internal: the `browser` extension               │
│                                                                 │
│   resource.provide(): opens BrowserSession, starts tracing,     │
│                       attaches page-error observers,            │
│                       wires cancellation signal                 │
│   resource.cleanup(): saves trace (per policy), closes session  │
│                                                                 │
│   events: browser:opened, browser:closed, browser:navigated,    │
│           browser:page-error, browser:console-error,            │
│           browser:tracing-saved, browser:page-opened,           │
│           browser:page-closed, browser:session-opened,          │
│           browser:session-closed, storage:saved                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ wires
┌─────────────────┬────────┴────────┬──────────────────────────────┐
│ BrowserProvider │ SelectorRegistry│      StorageProvider         │
│   (contract)    │    (contract)   │        (contract)            │
└─────────────────┴─────────────────┴──────────────────────────────┘
```

The three contracts are plain interfaces. The `browser` extension is the
single piece of the library with engine-level lifecycle: it opens a
`BrowserSession` at the start of each run, attaches observability and
cancellation, and closes the session at the end, wiring the three
contracts into the task context.

Selectors and Storage have **no per-run lifecycle of their own**. They
are plain stateless services that the extension forwards to the context.
Any async setup or teardown they need (DB connection, S3 client
construction) happens at the composition root, before the engine is
built — see section 6.

---

## 3. The `BrowserProvider` contract

### What it does

A `BrowserProvider` opens and closes isolated browser sessions. The flow
does not know whether the browser is local, remote via CDP, or part of a
pool — only that calling `open()` returns a fresh session.

### Interface

```ts
interface BrowserSession {
    readonly context: BrowserContext;  // Playwright BrowserContext
    readonly page: Page;                // Playwright Page (the main tab)
}

interface OpenOptions {
    contextOptions?: BrowserContextOptions;  // Playwright native
}

interface BrowserProvider {
    open(options?: OpenOptions): Promise<BrowserSession>;
    close(session: BrowserSession): Promise<void>;
    dispose(): Promise<void>;
}
```

### Method semantics

- `open()` returns a session with its own `BrowserContext` (cookies,
  localStorage, permissions) and a fresh `Page`. The implementation
  decides whether to launch a new browser process, reuse one, or connect
  to a remote endpoint. Throws `BrowserSessionError` on failure (with
  the underlying Playwright error in `cause`).
- `close(session)` closes the page and context for that session. Must be
  idempotent: must not throw if the page or context is already closed.
- `dispose()` shuts down provider-level resources (the underlying
  browser process for local, the CDP connection for remote). Called once
  by the application at shutdown. After `dispose()`, calling `open()`
  must throw `BrowserProviderDisposedError`. Calling `dispose()` again
  is a no-op.
- `OpenOptions.contextOptions` is passed through to
  `browser.newContext()`. The user controls viewport, locale, proxy,
  recording, geolocation, permissions, and everything else Playwright
  exposes without the provider wrapping each option.

### Lifecycle ownership

```
Application constructs provider           → application calls dispose()
  Browser extension calls open()          → extension calls close(session)
    Each open() returns an isolated session
```

The browser extension calls `open()` once per flow run from its
`resource.provide` and `close(session)` from its `resource.cleanup`. The
provider's `dispose()` is the application's responsibility — the engine
does not own provider lifecycle, because a single provider typically
serves many engines and many runs.

### Concurrent open() safety

Implementations must support concurrent `open()` calls. The
`browser.newSession()` factory (section 9) can run in parallel branches
or iterations, issuing many concurrent `open()` calls against the same
provider. `LocalBrowserProvider` and `RemoteBrowserProvider` reuse one
browser process / one CDP connection and create N concurrent contexts —
this is the recommended pattern. Implementations that cannot tolerate
concurrent opens must internally serialize.

### Reference: `LocalBrowserProvider`

Ships in v1.

```ts
class LocalBrowserProvider implements BrowserProvider {
    constructor(launchOptions?: LocalLaunchOptions);
}

interface LocalLaunchOptions {
    channel?: "chromium" | "chrome" | "msedge";
    headless?: boolean;
    executablePath?: string;
    // ...plus passthrough of Playwright's LaunchOptions
}
```

Behavior:

- Launches the browser lazily on the first `open()` call.
- Reuses the same browser process across `open()` calls within one
  provider instance.
- Each `open()` creates a fresh `BrowserContext` + `Page`.
- `dispose()` terminates the browser process.
- After `dispose()`, `open()` rejects with `BrowserProviderDisposedError`.
- Defaults: `{ channel: "chrome", headless: true }`.

### Writing a custom provider: `RemoteBrowserProvider` example

The contract is the extension point. A user implements it directly:

```ts
class RemoteBrowserProvider implements BrowserProvider {
    private browser?: Browser;
    private disposed = false;

    constructor(private readonly cdpEndpoint: string) {}

    async open(options?: OpenOptions): Promise<BrowserSession> {
        if (this.disposed) throw new BrowserProviderDisposedError();
        // Cache the CDP connection across open() calls
        this.browser ??= await chromium.connectOverCDP(this.cdpEndpoint);
        const context = await this.browser.newContext(options?.contextOptions);
        const page = await context.newPage();
        return { context, page };
    }

    async close(session: BrowserSession): Promise<void> {
        await session.context.close().catch(() => { /* idempotent */ });
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        await this.browser?.close().catch(() => {});
    }
}
```

Same shape, different lifecycle. The flow code does not change. Note
that the CDP connection is cached at the provider level rather than
created per `open()` — important for cost and latency in remote setups.

---

## 4. The `SelectorRegistry` contract

### What it does

Decouples selector strings from step code. Steps reference selectors by
name; the registry resolves them to Playwright locators. Changing a
selector means editing the registry source, not hunting through tasks.

### Interface

```ts
type LocatorScope = Page | Frame | Locator;

interface SelectorDefinition {
    selector: string;        // Playwright native locator string
    description?: string;    // human-readable doc
    timeout?: number;        // overrides default timeout for this selector (ms)
}

interface SelectorRegistry {
    get(name: string): MaybePromise<SelectorDefinition>;
    resolve(name: string, scope: LocatorScope): MaybePromise<Locator>;
}
```

### Method semantics

- `get(name)` returns the definition. Throws `SelectorNotFoundError` if
  the name does not exist. Returns `MaybePromise` so in-memory
  implementations can be synchronous and avoid a microtask cost per
  call.
- `resolve(name, scope)` looks up the definition and returns
  `scope.locator(definition.selector)`. The returned Locator is raw —
  no auto-wait. Playwright handles waiting inside action methods
  (`click`, `fill`, etc.).
- `scope` accepts `Page | Frame | Locator`. This is critical for
  real-world automation: iframes (`page.frameLocator(...)`), nested
  scoping inside a known parent (`locator.locator(...)`), and popups
  (`page.context.pages()[1]`) are common. Forcing `scope = Page` would
  exclude these.
- Both methods throw `SelectorNotFoundError` for unknown names; other
  errors propagate as-is (Playwright errors, network errors from a
  remote registry, etc.).

### `timeout` semantics

`SelectorDefinition.timeout` is informational metadata for the selector,
not automatically applied to actions on the returned Locator (Playwright
locators do not carry a default timeout). Consumers that want per-
selector timeouts pass it to actions explicitly:

```ts
const def = await ctx.selectors.get("login.submit");
await (await ctx.selectors.resolve("login.submit", ctx.page)).click({ timeout: def.timeout });
```

Or they use the registry as documentation only and rely on the page-
level `defaultTimeout` (section 7).

### Selector format

Selectors use Playwright's native locator string syntax. No translation:

```
role=button[name="Submit"]
text=Login
css=#login-btn
xpath=//div[@class='main']
[data-testid="login"]
```

### Naming convention

Selector names use dot notation by convention for organization
(`"login.usernameInput"`, `"dashboard.dateFilter"`). The store is flat —
dots are part of the key string, not a structural hierarchy.

### Reference: `JsonSelectorRegistry`

Ships in v1.

```ts
class JsonSelectorRegistry implements SelectorRegistry {
    static async load(filePath: string): Promise<JsonSelectorRegistry>;
    static fromObject(definitions: Record<string, SelectorDefinition>): JsonSelectorRegistry;
}
```

Behavior:

- `load()` reads a JSON file, parses it, freezes the entries.
- `fromObject()` skips the file step — useful for tests and
  code-defined selectors.
- All methods resolve synchronously from an in-memory `Map`
  (`MaybePromise` lets this skip a microtask).
- Hot reload is exposed as an instance method on the concrete class
  (`reload(): Promise<void>`), not on the contract.

Example JSON:

```json
{
  "login.usernameInput": {
    "selector": "[data-testid='username']",
    "description": "Username input on the login page"
  },
  "login.submitButton": {
    "selector": "role=button[name='Sign in']",
    "timeout": 10000
  }
}
```

### Writing a custom registry: `DbSelectorRegistry` example

```ts
class DbSelectorRegistry implements SelectorRegistry {
    constructor(private readonly client: DbClient) {}

    async get(name: string): Promise<SelectorDefinition> {
        const row = await this.client.query<SelectorDefinition>(
            "SELECT selector, description, timeout FROM selectors WHERE name = $1",
            [name]
        );
        if (!row) throw new SelectorNotFoundError(name);
        return row;
    }

    async resolve(name: string, scope: LocatorScope): Promise<Locator> {
        const def = await this.get(name);
        return scope.locator(def.selector);
    }

    // Implementation-specific extension method, not part of the contract
    async getMany(names: string[]): Promise<Record<string, SelectorDefinition>> {
        /* batched query — accessed via the concrete class when batching matters */
    }
}
```

Implementation-specific methods (batching, hot reload, cache invalidation)
are exposed on the concrete class, not added to the base contract. Code
that needs those operations works against the concrete class; code that
only needs lookup works against the interface.

---

## 5. The `StorageProvider` contract

### What it does

Abstracts file storage. Flows that download files, capture screenshots,
generate reports, persist artifacts, or save Playwright traces use this
interface. The backend can be the local filesystem, S3, R2, GCS, or
anything else.

### Interface

```ts
interface StorageLocation {
    kind: "file" | "url" | "uri";
    value: string;  // absolute file path / signed URL / s3://bucket/key
}

interface StorageObjectInfo {
    key: string;
    size: number;
    modifiedAt: Date;
    metadata?: Record<string, string>;
}

interface StorageResult {
    key: string;
    location: StorageLocation;
    size: number;
    metadata?: Record<string, string>;
}

interface StorageListPage {
    keys: string[];
    nextCursor?: string;  // undefined when no more pages
}

interface StorageProvider {
    save(key: string, data: Uint8Array, metadata?: Record<string, string>): Promise<StorageResult>;
    saveStream(key: string, data: ReadableStream<Uint8Array>, metadata?: Record<string, string>): Promise<StorageResult>;
    read(key: string): Promise<Uint8Array>;
    readStream(key: string): Promise<ReadableStream<Uint8Array>>;
    head(key: string): Promise<StorageObjectInfo>;
    exists(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    list(prefix?: string, cursor?: string, limit?: number): Promise<StorageListPage>;
}
```

### Method semantics

- `save(key, data, metadata?)` stores `data` (a `Uint8Array`) at `key`.
  The implementation creates any directories or structure internally.
  `metadata` is forwarded to backends that support per-object metadata
  (S3, R2, GCS); ignored otherwise. Returns the final `location`, byte
  count, and whatever subset of `metadata` was retained.
- `saveStream(key, stream, metadata?)` is the streaming variant — for
  large files (PDF, video, downloads) that should not be buffered in
  memory. Implementations that lack streaming support may internally
  buffer and fall through to `save`, but must document this.
- `read(key)` returns the stored data as a `Uint8Array`. Throws
  `StorageError` if the key does not exist.
- `readStream(key)` returns a `ReadableStream<Uint8Array>`. Throws
  `StorageError` if the key does not exist.
- `head(key)` returns size, modification time, and metadata without
  fetching the body. Throws `StorageError` if the key does not exist.
  Used by idempotent flows that conditionally re-download.
- `exists(key)` returns whether the key resolves to stored data.
  Critical for idempotent flows that re-run after a partial failure.
- `delete(key)` removes the key. Idempotent: does not throw if the key
  does not exist. "Not there" is the desired post-condition, not an
  error.
- `list(prefix?, cursor?, limit?)` returns a page of keys. `cursor` is
  opaque and round-tripped from a previous `nextCursor`. `limit`
  hints page size; implementations may return fewer. Pagination is
  required because cloud buckets can contain millions of objects.
- All methods throw `StorageError` on failure, preserving the underlying
  cause via `cause`.

### Why `Uint8Array` and not `Buffer`

`Buffer` is Node-only. `Uint8Array` is a JavaScript primitive that runs
on Node, Bun, Deno, and edge runtimes. `Buffer extends Uint8Array`, so
Node implementations can still pass / return Buffers directly — the
contract just declares the narrower type.

### Reference: `FileStorageProvider`

Ships in v1.

```ts
class FileStorageProvider implements StorageProvider {
    constructor(basePath: string);
}
```

- Keys are resolved relative to `basePath`.
- `save()` creates intermediate directories.
- `saveStream()` pipes the `ReadableStream` to a file write stream.
- `readStream()` returns an fs read stream wrapped as a web
  `ReadableStream`.
- `list()` walks the tree under `basePath + prefix`. The cursor is the
  last key returned in the previous page (lexicographic continuation).
- `location` is `{ kind: "file", value: absolutePath }`.

The name `FileStorageProvider` avoids the mental collision with the web
`localStorage` API.

### Writing a custom provider: `S3StorageProvider` example

```ts
class S3StorageProvider implements StorageProvider {
    constructor(
        private readonly client: S3Client,
        private readonly bucket: string,
    ) {}

    async save(key, data, metadata) {
        await this.client.putObject({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            Metadata: metadata,
        });
        return {
            key,
            location: { kind: "uri", value: `s3://${this.bucket}/${key}` },
            size: data.byteLength,
            metadata,
        };
    }
    // saveStream, read, readStream, head, exists, delete, list...
}
```

---

## 6. Composition root: initializing infrastructure

Selectors and Storage may need async setup (open a DB connection, load
a config file, build a cloud client). The application performs that
setup **before** constructing the engine. The browser extension treats
them as plain stateless dependencies.

```ts
// main.ts — your application's composition root

// 1. Async setup of infrastructure
const dbClient = await createDbClient(process.env.DB_URL!);
const selectors = new DbSelectorRegistry(dbClient);

const s3 = createS3Client({ region: "us-east-1" });
const storage = new S3StorageProvider(s3, "scrapes");

const provider = new LocalBrowserProvider({ headless: true });

// 2. Build the engine with the dependencies already wired
const engine = createBrowserEngine({ provider, selectors, storage });

// 3. Run flows
await engine.run(myFlow, params);

// 4. Teardown when the application is shutting down
await provider.dispose();
await dbClient.close();
// S3 client is HTTP-stateless, nothing to dispose
```

Why this and not lifecycle methods on the contracts:

- Selectors and Storage have **no per-run state**. They are configured
  services with methods that the run uses. The run does not own them.
- A DB connection or S3 client typically serves many runs and many
  engines. Tying its lifecycle to a single flow run would be wasteful.
- Forcing `init()`/`dispose()` on every contract penalizes simple
  implementations (`JsonSelectorRegistry`, `FileStorageProvider`) with
  empty methods.
- The composition root is where infrastructure naturally goes. The
  framework does not need to invent another lifecycle hook for it.

`BrowserProvider` is the exception — it does have per-run state (a fresh
session per run), which is why it has `open()` / `close(session)` for
per-run cycles and `dispose()` for app-level cleanup.

---

## 7. The `browser` extension

### What it provides to the task context

The extension wires the three contracts together and exposes the user-
facing capabilities. Every task in a browser flow sees these in its
context:

| Field          | Type                                | Description                                                |
|----------------|-------------------------------------|------------------------------------------------------------|
| `session`      | `BrowserSession`                    | The session (context + page) for the current scope         |
| `page`         | `Page`                              | Shortcut: `session.page` — the active tab                  |
| `provider`     | `BrowserProvider`                   | The provider passed at engine construction                 |
| `selectors`    | `SelectorRegistry`                  | The registry passed at engine construction                 |
| `storage`      | `StorageProvider`                   | The storage passed at engine construction                  |
| `navigate`     | `(url, options?) => Promise<void>`  | Logged + observable wrapper around `page.goto`             |

The user is expected to call Playwright methods directly:
`ctx.page.click(...)`, `ctx.page.fill(...)`, `ctx.page.screenshot(...)`,
`ctx.page.pdf(...)`, `ctx.session.context.cookies()`, etc. The package
does not add `ctx.click`, `ctx.fill`, or similar wrappers — see the
non-goals in section 1.

### Why `page` is a shortcut

In most browser flows, the task interacts with a single page. Writing
`context.session.page` everywhere is noise. `context.page` is the same
reference as `context.session.page`. When a nested resource swaps in a
new session (see section 9), both `context.session` and `context.page`
point to the new values. **Do not cache `const p = ctx.page` outside the
scope where it was obtained** — nested resources may swap it.

### Why `provider` is exposed

The `browser.newSession()` resource factory (section 9) needs to open a
new session inside a parallel branch or every iteration. It does so by
calling `context.provider.open()`. Exposing the provider in the context
keeps that factory implementable as plain user-space code, without the
extension needing to add custom hooks.

The provider is infrastructure; the user is expected to read from it
(through factories like `newSession`) and not call `dispose()` on it
inside a task.

### `navigate(url, options?)`

The one wrapper the extension exposes. Its sole job is observability and
typed-error handling, not Playwright API duplication.

```ts
type NavigateOptions = {
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
    timeout?: number;
};

context.navigate(url: string, options?: NavigateOptions): Promise<void>;
```

Behavior:

- Calls `page.goto(url, options)` on `context.page`.
- Logs the navigation via `context.log`.
- Emits `browser:navigated` with `{ url, durationMs }` on success.
- Wraps Playwright's `TimeoutError` and other navigation failures in
  `NavigationError`, preserving the original error via `cause` and
  carrying `url` and `durationMs`.
- Does not retry — retries are the task's responsibility via its
  `retry` configuration.

Users who don't want the event/log overhead call `context.page.goto()`
directly. `navigate` is opt-in syntactic sugar.

### Configuration

```ts
interface BrowserExtensionConfig {
    provider: BrowserProvider;
    selectors: SelectorRegistry;
    storage: StorageProvider;
    openOptions?: OpenOptions;            // forwarded to provider.open() per run

    // Timeouts: applied via page.setDefaultTimeout / setDefaultNavigationTimeout
    defaultTimeout?: number;              // Playwright's "action" timeout
    defaultNavigationTimeout?: number;    // only goto / waitForNavigation

    // Observability bridging (all default true; set false to disable)
    observePageErrors?: boolean;          // page.on("pageerror") -> browser:page-error
    observeConsoleErrors?: boolean;       // page.on("console") filtered to error
    emitNavigateEvent?: boolean;          // browser:navigated from ctx.navigate
    emitStorageEvent?: boolean;           // browser:storage-saved from storage proxy

    // Tracing (see section 10)
    trace?: TraceConfig;

    // Cancellation (see section 11)
    cancelStrategy?: "close-context" | "none";  // default "close-context"
}
```

`defaultTimeout` and `defaultNavigationTimeout` are applied to the
session's page right after `open()` via Playwright's
`page.setDefaultTimeout` / `setDefaultNavigationTimeout`. They make the
"cancel responsiveness" tradeoff explicit: lower values mean
cancellation feels faster, at the cost of more aggressive timeouts on
legitimate slow operations.

The default timeouts also apply to the page in branch-level sessions
opened via `browser.newSession()` and to new tabs opened via
`browser.newPage()`, so behaviour is consistent across the whole run.

### Events emitted

| Event                     | Visibility | Payload                                            | When                                                       |
|---------------------------|------------|----------------------------------------------------|------------------------------------------------------------|
| `browser:opened`          | public     | `{}`                                               | After `provider.open()` succeeds in the extension's setup  |
| `browser:closed`          | public     | `{}`                                               | After `provider.close(session)` in the extension's cleanup |
| `browser:navigated`       | public     | `{ url: string; durationMs: number }`              | After `context.navigate(url)` succeeds                     |
| `browser:page-error`      | public     | `{ message: string; stack?: string }`              | `page.on("pageerror")` from any session page               |
| `browser:console-error`   | public     | `{ text: string; location?: ConsoleLocation }`     | `page.on("console")` filtered to `type === "error"`        |
| `browser:page-opened`     | public     | `{ branch?: string; iteration?: number }`          | After `newPage` factory provisions a tab                   |
| `browser:page-closed`     | public     | `{ branch?: string; iteration?: number }`          | After `newPage` factory cleans up a tab                    |
| `browser:session-opened`  | public     | `{ branch?: string; iteration?: number }`          | After `newSession` factory provisions a session            |
| `browser:session-closed`  | public     | `{ branch?: string; iteration?: number }`          | After `newSession` factory cleans up a session             |
| `browser:tracing-saved`   | public     | `{ key: string; size: number; reason: TraceReason }` | After a Playwright trace is saved to storage             |
| `browser:storage-saved`   | public     | `{ key: string; size: number }`                    | After any `context.storage.save()` / `saveStream()` call   |

Notes:

- `browser:page-error` and `browser:console-error` are observability
  bridges over Playwright's native page events. They do not change
  Playwright behavior — they only republish events on the bus so flow
  logs surface page-level failures. Toggleable individually because
  console errors can be noisy on certain sites.
- The dialog event (`page.on("dialog")`) is **not** auto-bridged. Adding
  a listener that does not call `dialog.accept()` / `dialog.dismiss()`
  causes the page to hang. Users who want to observe and handle dialogs
  attach their own listener.
- `browser:storage-saved` is emitted by a wrapping proxy over the
  provided `StorageProvider`, not by the implementation itself. This
  keeps implementations agnostic of events.
- No `selector:resolved` event. Too high-frequency, low signal.
- All events are public so external subscribers (dashboards, audit
  logs) see them.

---

## 8. Public API

The user imports only from `@flowrun/browser`. Core types are accessible
if the user wants advanced work, but typical flows do not require it.

### Engine construction

```ts
import {
    createBrowserEngine,
    LocalBrowserProvider,
    JsonSelectorRegistry,
    FileStorageProvider,
} from "@flowrun/browser";

const engine = createBrowserEngine({
    provider: new LocalBrowserProvider({ headless: true }),
    selectors: await JsonSelectorRegistry.load("./selectors.json"),
    storage: new FileStorageProvider("./downloads"),
    defaultNavigationTimeout: 15_000,
    trace: { mode: "on-failure" },
});
```

`createBrowserEngine` returns a typed core `Engine` with the `browser`
extension already installed. The returned engine still has `.use()`
available, so additional extensions can be composed:

```ts
const engine = createBrowserEngine(browserConfig).use(metricsExtension());
```

### Defining a flow — simple case

```ts
import { browser } from "@flowrun/browser";

const scrape = browser.flow<
    { startUrl: string },                     // params
    { title: string; links: string[] }        // state
>({
    name: "scrape",
    state: () => ({ title: "", links: [] }),
    nodes: ({ task }) => [
        task({
            name: "open-page",
            run: async (ctx) => {
                await ctx.navigate(ctx.params.startUrl);
                ctx.state.set("title", await ctx.page.title());
            },
        }),
        task({
            name: "collect-links",
            run: async (ctx) => {
                const links = await ctx.page.$$eval(
                    "a[href]",
                    (anchors) => anchors.map((a) => a.href),
                );
                ctx.state.set("links", links);
            },
        }),
    ],
});

const result = await engine.run(scrape, { startUrl: "https://example.com" });
```

`browser.flow<TParams, TState>` is the shortcut for flows that do not
declare custom events. Task callbacks see `ctx.page`, `ctx.navigate`,
`ctx.selectors`, `ctx.storage`, `ctx.session`, `ctx.provider` with full
typing.

### Defining a flow — scoped definitions with custom events

```ts
import { browser } from "@flowrun/browser";

interface InvoiceContract {
    params: { account: string };
    state: { downloaded: string[] };
    events: { "invoice:downloaded": { key: string } };
}

const invoice = browser.scope<InvoiceContract>();

const downloadTask = invoice.task({
    name: "download-pdf",
    run: async (ctx) => {
        const buffer = await ctx.page.pdf();
        const result = await ctx.storage.save(`${ctx.params.account}.pdf`, buffer);
        ctx.state.set("downloaded", [...ctx.state.get("downloaded"), result.key]);
        await ctx.publish("invoice:downloaded", { key: result.key });
    },
});

const invoiceFlow = invoice.flow({
    name: "download-invoices",
    state: () => ({ downloaded: [] }),
    nodes: [downloadTask],
});
```

`browser.scope<TContract>()` is the analog of core's `define.scope()`,
with the browser extension's provided context and events pre-mixed into
the user's contract.

### Contract merging semantics

When the user's contract declares `provided`, `events`, or
`internalEvents`, these are **merged** with the browser extension's
own provided context and events — never replaced.

- `contract.provided`: union with the extension's provided fields
  (`session`, `page`, `provider`, `selectors`, `storage`, `navigate`).
  The user can add fields but cannot remove or shadow these.
- `contract.events`: union with the extension's public events
  (`browser:opened`, `browser:navigated`, etc.) and core's system events.
- `contract.internalEvents`: passed through to the scope as private
  internal events visible only to subscribers within the same scope.

If the user declares a field with the same name as an extension-provided
field, a type error surfaces at scope construction. There is no runtime
override path.

### Mounting the extension on a manually-built engine

`browser.extension(config)` returns a raw extension definition that can
be mounted on any core engine:

```ts
import { createEngine } from "@flowrun/core";
import { browser } from "@flowrun/browser";

const engine = createEngine().use(
    browser.extension({ provider, selectors, storage }),
);
```

This is the escape hatch for users composing multiple extensions on a
custom engine. `createBrowserEngine` is the primary path.

---

## 9. Resource factories: `newPage` and `newSession`

The core's `parallel` and `every` accept an optional `resource: {
provide, cleanup? }` config that provisions per-branch (parallel) or
per-iteration (every) resources visible to the child scope. The browser
package exports two factories that return pre-built resources for the
two common patterns.

### `browser.newPage()` — shared session, new tab

Opens a new `Page` from the parent's `BrowserContext` for each branch /
iteration. All siblings share the same session, so login state, cookies,
and `localStorage` carry over.

```ts
parallel({
    name: "scrape-sections",
    resource: browser.newPage(),
    merge: "append",
    nodes: ({ task }) => [
        task({
            name: "invoices",
            run: async (ctx) => {
                await ctx.navigate("https://portal.example.com/invoices");
                // ctx.page is a new tab; the login session is the parent's
            },
        }),
        task({
            name: "reports",
            run: async (ctx) => {
                await ctx.navigate("https://portal.example.com/reports");
                // another new tab, same session
            },
        }),
    ],
});
```

Use case: scrape multiple sections of one portal in parallel after a
single login.

Under the hood the factory returns:

```ts
{
    provide: async (ctx, meta) => {
        const page = await ctx.session.context.newPage();
        if (ctx.extensionConfig.defaultTimeout) page.setDefaultTimeout(...);
        if (ctx.extensionConfig.defaultNavigationTimeout) page.setDefaultNavigationTimeout(...);
        await ctx.bus.publish("browser:page-opened", { branch: meta.branchName, iteration: meta.index });
        const session: BrowserSession = { context: ctx.session.context, page };
        return { session, page };
    },
    cleanup: async (ctx, meta) => {
        await ctx.page.close().catch(() => {});
        await ctx.bus.publish("browser:page-closed", { branch: meta.branchName, iteration: meta.index });
    },
}
```

The child scope sees `session` and `page` replaced with the forked
values; everything else (`provider`, `selectors`, `storage`, etc.) is
inherited from the parent. The new tab inherits the extension's default
timeouts.

### `browser.newSession(options?)` — isolated session

Opens a fresh `BrowserContext` and `Page` from the provider for each
branch / iteration. Each sibling has its own cookies, `localStorage`,
authentication — full isolation.

```ts
every({
    name: "test-each-user",
    items: (ctx) => ctx.params.users,
    resource: browser.newSession({
        contextOptions: { viewport: { width: 1920, height: 1080 } },
    }),
    concurrency: 3,
    merge: "append",
    nodes: ({ task }) => [
        task({
            name: "login-as-user",
            run: async (ctx) => {
                // ctx.session is brand new — fresh cookies, no shared state
                await ctx.navigate("https://portal.example.com/login");
                // login as ctx.iteration.item
            },
        }),
    ],
});
```

Use cases:

- Run the same flow against N accounts in parallel.
- Iterate over N tenants where session bleed would break the flow.
- Tests that must not share `localStorage` across branches.

Under the hood:

```ts
{
    provide: async (ctx, meta) => {
        const session = await ctx.provider.open(options);
        if (ctx.extensionConfig.defaultTimeout) session.page.setDefaultTimeout(...);
        if (ctx.extensionConfig.defaultNavigationTimeout) session.page.setDefaultNavigationTimeout(...);
        await ctx.bus.publish("browser:session-opened", { branch: meta.branchName, iteration: meta.index });
        return { session, page: session.page };
    },
    cleanup: async (ctx, meta) => {
        await ctx.provider.close(ctx.session);
        await ctx.bus.publish("browser:session-closed", { branch: meta.branchName, iteration: meta.index });
    },
}
```

Branch-level sessions inherit the extension's `defaultTimeout` and
`defaultNavigationTimeout` for consistency with the main session.

### Choosing between them

- Same authentication, parallel tabs → `newPage()`.
- Different identities, parallel isolation → `newSession()`.
- Sequential without isolation → no resource needed; the flow's main
  session carries through.

Both factories are typed to be compatible with `parallel` and `every`.
The same factory call works in either node.

### Cleanup on task failure

Resource `cleanup` always runs in a `finally` block (core guarantee), so
a thrown task error inside the branch still triggers `close(session)` or
`page.close()`. No resource leak path on failure.

### Concurrent resource provisioning

When `every` runs N iterations concurrently with `newSession`, the
provider receives N concurrent `open()` calls. Per section 3, providers
must tolerate this. The default `LocalBrowserProvider` opens N contexts
against one browser process, which is the cheap path.

---

## 10. Tracing

Playwright traces are the highest-leverage debugging tool for browser
automation. The extension integrates tracing as a first-class concern,
saving traces to `StorageProvider` based on flow outcome.

### Configuration

```ts
type TraceMode =
    | "off"               // never start tracing
    | "on"                // always start, always save
    | "on-failure"        // always start, only save if flow fails
    | "retain-on-failure" // always start, save only on failure, discard on success

interface TraceConfig {
    mode: TraceMode;
    screenshots?: boolean;     // default true
    snapshots?: boolean;       // default true
    sources?: boolean;         // default false
    storageKey?: (ctx: { runId: string; flowName: string }) => string;
    // default: `traces/${flowName}/${runId}.zip`
}
```

`mode: "off"` is the default — tracing is opt-in.

### Behavior

The extension calls `context.tracing.start({ screenshots, snapshots, sources })`
inside `resource.provide` (when `mode !== "off"`). In `resource.cleanup`,
based on the flow result:

- `mode: "on"`: always call `context.tracing.stop({ path: tmpZip })`,
  then save to storage at the computed key.
- `mode: "on-failure"`: stop and save only if the run status is `failed`.
- `mode: "retain-on-failure"`: stop unconditionally; save only if
  failed; discard the temp zip if successful.

After saving, the extension emits `browser:tracing-saved` with the
storage key, size, and a reason (`"always" | "on-failure" | "retained"`).

### Branch-level tracing

For `newSession`-provided contexts, tracing is per-context (Playwright
limitation). The factory does not auto-start tracing for branch
sessions in v1 — users who need branch traces start tracing explicitly
in the first task of the branch. v2 may add `newSession({ trace: ... })`
for convenience.

### Trace storage key collisions

The default key includes `runId`, so concurrent runs do not collide. If
the user overrides `storageKey` to a fixed value, they own collision
avoidance.

---

## 11. Cancellation

The core's `handle.cancel(reason)` signals an `AbortSignal` that
propagates through the task context as `ctx.signal`. By default,
Playwright actions do not honour an `AbortSignal` — a `page.click()`
that is hanging on a broken element selector will continue until the
action's `timeout` fires.

The browser extension narrows this gap by closing the active
`BrowserContext` when the signal aborts, causing pending Playwright
operations to reject promptly with a recognisable "context closed"
error.

### v1 implementation scope

The core invokes `extension.resource.provide` **before** the run's
`AbortController` exists, so the main extension cannot install a signal
listener from its own `provide`. The v1 implementation works around
this by attaching the abort listener at the points where the signal is
available:

- **Inside `browser.newPage()` / `browser.newSession()` factories.**
  These are `parallel` / `every` resources, and their `provide`
  receives a context with `signal`. Both factories attach an abort
  listener that closes the nested `BrowserContext` (for `newSession`)
  or the nested `Page` (for `newPage`).
- **For the main session opened by the extension itself**, no auto
  cancellation in v1. The user controls mid-task delay through
  `defaultTimeout` / `defaultNavigationTimeout`. A short timeout makes
  cancellation responsive on the order of the timeout value.

### Strategy options

```ts
type CancelStrategy =
    | "close-context"   // default: factories attach abort listeners
    | "none"            // factories do not attach listeners
```

The flag controls only the factory behavior in v1. The main session is
unaffected.

### `close-context` semantics (factory-only in v1)

Inside `newPage` / `newSession` `provide`:

```ts
ctx.signal.addEventListener("abort", () => {
    nestedSession.context.close().catch(() => {});
}, { once: true });
```

When the signal aborts:

1. The listener fires, closing the nested context (or page).
2. Any pending Playwright call inside the branch rejects with an error
   referencing context closure.
3. The user task either propagates the error (the task fails, the
   branch moves to cancellation) or catches it and exits.
4. The standard cleanup path runs: `close(session)` is idempotent and
   the already-closed context is a no-op.

### Manual main-session cancellation

For flows that need responsive cancellation on the main session
without nested factories, attach the listener in the first task:

```ts
task({
    name: "setup-cancellation",
    run: (ctx) => {
        ctx.signal.addEventListener(
            "abort",
            () => { ctx.session.context.close().catch(() => {}); },
            { once: true },
        );
    },
});
```

A future core change (creating the `AbortController` before
provisioning extensions) would lift the v1 limitation without changing
the public API.

---

## 12. Recipes

These are not part of the public API. They are documented patterns the
package supports out of the box because the contracts are designed for
them.

### Auth state save/load

Persist a logged-in `BrowserContext` to storage and reuse it across runs.

```ts
// Saving after a login flow:
const state = await ctx.session.context.storageState();
await ctx.storage.save(
    `auth/${ctx.params.account}.json`,
    new TextEncoder().encode(JSON.stringify(state)),
);

// Loading into a new session via newSession:
const stored = await ctx.storage.read(`auth/${ctx.params.account}.json`);
const storageState = JSON.parse(new TextDecoder().decode(stored));

every({
    items: (ctx) => ctx.params.accounts,
    resource: browser.newSession({
        contextOptions: { storageState },  // Playwright native option
    }),
    // ...
});
```

A v2 helper `browser.newSessionWithAuth(authKey)` may wrap this pattern.

### Downloads

Use Playwright's native `download` event directly. The extension does
not wrap it.

```ts
task({
    name: "download-report",
    run: async (ctx) => {
        const [download] = await Promise.all([
            ctx.page.waitForEvent("download"),
            ctx.page.click("text=Export PDF"),
        ]);
        const buffer = await download.createReadStream();
        await ctx.storage.saveStream(`reports/${download.suggestedFilename()}`, buffer);
    },
});
```

### Network interception

Playwright's `page.route()` is the canonical way to mock, block, or
modify requests. The extension does not wrap it.

```ts
task({
    name: "block-assets",
    run: async (ctx) => {
        await ctx.page.route("**/*.{png,jpg,svg}", (route) => route.abort());
        await ctx.navigate("https://example.com");
    },
});
```

### Headed mode for debugging

Driven entirely through `LocalLaunchOptions`. A common pattern:

```ts
const provider = new LocalBrowserProvider({
    headless: process.env.HEADLESS !== "false",
    channel: "chrome",
});
```

### Device emulation

Use Playwright's `devices` map directly via `contextOptions`:

```ts
import { devices } from "playwright-core";

const engine = createBrowserEngine({
    provider,
    selectors,
    storage,
    openOptions: { contextOptions: devices["iPhone 13"] },
});
```

### Permissions / geolocation

Pass through `contextOptions`:

```ts
openOptions: {
    contextOptions: {
        permissions: ["geolocation"],
        geolocation: { latitude: 41.39, longitude: 2.16 },
    },
},
```

### Concurrent key collisions in storage

When `every` runs concurrently with multiple branches saving to the
same key, the last write wins (filesystem) or behaviour is backend-
dependent (S3). Users are responsible for namespacing keys with
iteration-level information:

```ts
const key = `${ctx.params.runDate}/${ctx.iteration.item}.pdf`;
```

The package does not auto-prefix keys with `runId`.

### Memory / resource pressure

A flow that opens 100 parallel sessions consumes browser-process RAM,
file descriptors, and CDP message bandwidth. Users control concurrency
through `every({ concurrency })`. The package does not impose limits.

---

## 13. Error types

All browser-specific errors extend the core's `FlowEngineError`. They
carry no execution IDs — the engine attaches that through events and
results.

| Error class                     | Thrown when                                              | Extra fields                          |
|---------------------------------|----------------------------------------------------------|---------------------------------------|
| `BrowserError`                  | Base class for everything below                          | —                                     |
| `SelectorNotFoundError`         | `SelectorRegistry.get()` on an unknown name              | `selectorName: string`                |
| `NavigationError`               | `context.navigate()` fails (timeout or other)            | `url: string; durationMs: number`     |
| `BrowserSessionError`           | `BrowserProvider.open()` / `close()` fails               | `phase: "open" \| "close"`            |
| `BrowserProviderDisposedError`  | `BrowserProvider.open()` after `dispose()`               | —                                     |
| `StorageError`                  | Any `StorageProvider` operation failure                  | `key: string; operation: string`      |

All errors support `cause` for chaining the underlying Playwright,
filesystem, or cloud error. A `NavigationError` thrown from a
Playwright timeout has `error.cause instanceof TimeoutError`.

---

## 14. End-to-end example

```ts
import {
    createBrowserEngine,
    browser,
    LocalBrowserProvider,
    JsonSelectorRegistry,
    FileStorageProvider,
} from "@flowrun/browser";

// Composition root: build infrastructure
const provider = new LocalBrowserProvider({ headless: true, channel: "chrome" });
const selectors = await JsonSelectorRegistry.load("./selectors.json");
const storage = new FileStorageProvider("./downloads");

const engine = createBrowserEngine({
    provider,
    selectors,
    storage,
    defaultNavigationTimeout: 15_000,
    trace: { mode: "on-failure" },
});

// Flow definition
interface ReportContract {
    params: { user: string; pass: string; months: string[] };
    state: { downloaded: string[] };
}

const report = browser.scope<ReportContract>();

const downloadReports = report.flow({
    name: "download-reports",
    state: () => ({ downloaded: [] }),
    nodes: ({ task, every }) => [
        task({
            name: "login",
            run: async (ctx) => {
                await ctx.navigate("https://portal.example.com/login");
                const userField = await ctx.selectors.resolve("login.user", ctx.page);
                const passField = await ctx.selectors.resolve("login.pass", ctx.page);
                const submit = await ctx.selectors.resolve("login.submit", ctx.page);
                await userField.fill(ctx.params.user);
                await passField.fill(ctx.params.pass);
                await submit.click();
                await ctx.page.waitForURL(/dashboard/);
            },
        }),
        every({
            name: "scrape-each-month",
            items: (ctx) => ctx.params.months,
            concurrency: 3,
            merge: "append",
            resource: browser.newPage(),  // shared login, parallel tabs
            nodes: ({ task }) => [
                task({
                    name: "fetch-and-save",
                    run: async (ctx) => {
                        await ctx.navigate(`https://portal.example.com/reports?month=${ctx.iteration.item}`);
                        const pdf = await ctx.page.pdf();
                        const result = await ctx.storage.save(`${ctx.iteration.item}.pdf`, pdf);
                        ctx.state.set("downloaded", [result.key]);
                    },
                }),
            ],
        }),
    ],
});

// Execution
const result = await engine.run(downloadReports, {
    user: "alice@example.com",
    pass: process.env.PORTAL_PASS!,
    months: ["2025-01", "2025-02", "2025-03"],
});

if (result.status === "success") {
    console.log("Downloaded:", result.state.downloaded);
}

// Application shutdown
await provider.dispose();
```

Notes on this example:

- The user code imports nothing from `@flowrun/core`. The contract
  object has `params` and `state`; the extension's provided context and
  events are mixed in by `browser.scope`.
- Login uses `ctx.page.fill`/`ctx.page.click` through resolved
  Locators — there is no `ctx.fill` wrapper. The Locator's
  auto-waiting is Playwright's, not the package's.
- `every` uses `browser.newPage()` as its resource — same provider,
  shared login, one tab per month.
- For a multi-account variant where each iteration logs in as a
  different user, swap `browser.newPage()` for `browser.newSession()`
  and put the login inside the iteration's task.
- With `trace: { mode: "on-failure" }`, any failure causes a
  `traces/download-reports/${runId}.zip` to be written to
  `./downloads`, and a `browser:tracing-saved` event fires.

---

## 15. Public exports

```ts
// Engine
export { createBrowserEngine };

// Define namespace (analog of core's `define`)
export const browser: {
    flow<TParams, TState>(config): FlowDefinition;
    scope<TContract>(): BrowserScopedDefine<TContract>;
    extension(config): ExtensionDefinition;
    newPage(): /* resource compatible with parallel and every */;
    newSession(options?: OpenOptions): /* resource compatible with parallel and every */;
};

// Contracts
export type {
    BrowserProvider, BrowserSession, OpenOptions,
    SelectorRegistry, SelectorDefinition, LocatorScope,
    StorageProvider, StorageResult, StorageObjectInfo, StorageLocation, StorageListPage,
    BrowserContract, BrowserExtensionConfig, TraceConfig, TraceMode, CancelStrategy,
};

// Reference implementations
export { LocalBrowserProvider };
export type { LocalLaunchOptions };
export { JsonSelectorRegistry };
export { FileStorageProvider };

// Errors
export {
    BrowserError,
    SelectorNotFoundError,
    NavigationError,
    BrowserSessionError,
    BrowserProviderDisposedError,
    StorageError,
};

// Re-exported core types users typically need
export type { FlowResult, FlowStatus, FlowHandle, Logger, FlowEngineError } from "@flowrun/core";

// Re-exported Playwright types users will see in handler signatures
export type { Page, Locator, Frame, BrowserContext, BrowserContextOptions } from "playwright-core";
```

`FlowEngineError` is re-exported so users can write generic
`instanceof FlowEngineError` checks without pulling in `@flowrun/core`
directly. The Playwright types are re-exported so flow code can be
fully typed without the user adding `playwright` as a direct dep solely
for types (it remains a peer dep for the runtime).

---

## 16. What needs to be implemented

Concrete checklist for v1.

### Source layout

```
packages/browser/src/
  index.ts                     // public exports
  contracts/
    provider.ts                // BrowserProvider, BrowserSession, OpenOptions
    selectors.ts               // SelectorRegistry, SelectorDefinition, LocatorScope
    storage.ts                 // StorageProvider, StorageResult, StorageObjectInfo,
                               // StorageLocation, StorageListPage
  providers/
    local.ts                   // LocalBrowserProvider
  selectors/
    json.ts                    // JsonSelectorRegistry
  storage/
    file.ts                    // FileStorageProvider
  extension/
    browser-extension.ts       // the single core extension (resource: { provide, cleanup })
    navigate.ts                // navigate() factory bound to a page
    storage-wrap.ts            // wraps StorageProvider to emit browser:storage-saved
    page-observers.ts          // attaches pageerror/console-error listeners
    tracing.ts                 // start/stop/save Playwright tracing per TraceConfig
    cancellation.ts            // attaches AbortSignal -> context.close() listener
  resources/
    new-page.ts                // browser.newPage() factory
    new-session.ts             // browser.newSession() factory
  api/
    engine.ts                  // createBrowserEngine
    define.ts                  // the `browser` namespace
  errors.ts                    // BrowserError + subclasses
```

### Components

1. **Contracts** (`contracts/*.ts`). Pure interfaces, no
   implementations.
2. **Reference implementations** (`providers/local.ts`,
   `selectors/json.ts`, `storage/file.ts`). One per contract.
   `FileStorageProvider` must implement streaming (`saveStream` /
   `readStream`) and cursored `list`.
3. **The browser extension** (`extension/browser-extension.ts`).
   Built on `define.extension` from core. Its `resource.provide` opens
   the session, builds the `navigate` function, wraps storage, attaches
   page observers, starts tracing if configured, registers the
   cancellation listener, applies default timeouts, and returns the
   provided context. Its `resource.cleanup` saves the trace per policy,
   closes the session, removes listeners, and emits `browser:closed`.
4. **Storage wrapper** (`extension/storage-wrap.ts`). Transparent
   proxy over the user-provided `StorageProvider` that emits
   `browser:storage-saved` after a successful `save()` or `saveStream()`.
5. **Page observers** (`extension/page-observers.ts`). Subscribes to
   `page.on("pageerror")` and `page.on("console")` (filtered to errors)
   and republishes on the bus as `browser:page-error` /
   `browser:console-error`. Skipped if the corresponding config flag is
   `false`.
6. **Tracing** (`extension/tracing.ts`). Implements the four
   `TraceMode` strategies. Saves zip to `StorageProvider` and emits
   `browser:tracing-saved`.
7. **Cancellation** (`extension/cancellation.ts`). Attaches an
   `AbortSignal` `abort` listener that closes the active
   `BrowserContext`. Skipped if `cancelStrategy === "none"`.
8. **Resource factories** (`resources/new-page.ts`,
   `resources/new-session.ts`). Each returns a `{ provide, cleanup }`
   object typed to be compatible with the resource configs of `parallel`
   and `every`. Inherits the extension's default timeouts. Emits
   `browser:page-opened` / `browser:page-closed` /
   `browser:session-opened` / `browser:session-closed`.
9. **`createBrowserEngine`** (`api/engine.ts`). Builds a core `Engine`
   pre-loaded with the browser extension.
10. **`browser` namespace** (`api/define.ts`). Exposes
    `browser.flow<TParams, TState>(config)`,
    `browser.scope<TContract>()`, `browser.extension(config)`,
    `browser.newPage()`, `browser.newSession()`. Internally composes the
    user's contract with the browser extension's provided context and
    events.
11. **Errors** (`errors.ts`). Six classes extending core's
    `FlowEngineError`.

### Tests (out of scope of this document but listed for planning)

- Unit: each reference implementation against its contract, including
  streaming and pagination for storage.
- Integration: a flow using the extension against a real local Chrome,
  exercising login, scrape, download, both resource factories, tracing
  in all modes, cancellation through context closure, and page-error
  observability.
- Type tests: `browser.scope<MyContract>()` produces the expected
  context type with the extension's provided fields mixed in; declaring
  a `provided` field that collides with an extension field is a type
  error; `browser.newPage()` and `browser.newSession()` type-check
  inside both `parallel` and `every`.

---

## 17. Open questions for review

Decisions made in this document that are reversible and worth calling
out before implementation:

1. **`navigate` emits an event by default** but is toggleable via
   `emitNavigateEvent`. Reasonable default? Or off-by-default to avoid
   surprising volume on chatty flows?
2. **`storage:saved` is emitted by a wrapper, not by the
   `StorageProvider` itself.** Keeps implementations decoupled from
   events but means a custom `StorageProvider` cannot opt out of the
   event without a config flag.
3. **`session` and `page` are both exposed on the context.** Two ways
   to reach the same data. The shortcut is convenient but the
   duplication invites confusion. Alternative: only `session`. The
   current spec keeps both and documents the swap behaviour in section 7.
4. **Default `cancelStrategy: "close-context"`.** Aggressive cleanup on
   cancellation. Suitable as default, or should the safer `"none"` be
   default with users opting in to the responsive variant?
5. **`browser:console-error` on by default.** Some sites log frequently;
   the noise may be unwelcome. Could default to `false`.
6. **Tracing default is `mode: "off"`.** Conservative — no surprise
   storage usage. Should `on-failure` be default for production flows?
7. **`browser.flow<TParams, TState>` vs `browser.scope<TContract>().flow`
   coexist.** Mirrors core's pattern. Acceptable, or collapse to a
   single entry point?
8. **No `dialog` event bridge.** Documented as user responsibility.
   Adding it without auto-handling causes hangs; auto-handling changes
   Playwright semantics. Current decision: no bridge.
9. **`browser.newPage()` / `browser.newSession()` events carry only
   `branchName` / `iteration`, not the full `meta`.** Minimises payload
   surface. Add more fields if subscribers need them.
10. **`SelectorDefinition.timeout` is informational, not auto-applied.**
    Document only, do not silently apply via `setDefaultTimeout` for
    that selector. Consistent with "no wrappers around Playwright
    actions".

These are not blockers — pick a default and move on, revisit after
seeing the implementation.
