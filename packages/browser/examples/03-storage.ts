/**
 * 03-storage.ts — FileStorageProvider & StorageProvider API
 *
 * Covers:
 *  - context.storage.save(key, Uint8Array, metadata?)         -> StorageResult
 *  - context.storage.saveStream(key, ReadableStream, meta?)   -> StorageResult
 *  - context.storage.read(key)        -> Uint8Array
 *  - context.storage.readStream(key)  -> ReadableStream<Uint8Array>
 *  - context.storage.head(key)        -> StorageObjectInfo
 *  - context.storage.exists(key)      -> boolean
 *  - context.storage.list(prefix?, cursor?, limit?) -> { keys, nextCursor? }
 *  - context.storage.delete(key)
 *  - Integration: pipe a Playwright download into saveStream
 */

import { Readable } from "node:stream";
import {
    type BrowserShape,
    type Compose,
    createBrowserEngine,
    type SelectorsShape,
    type StorageShape,
    selectors,
    storage,
} from "@flowrun/browser";
import { flow } from "@flowrun/core";
import { BASE_URL, localBrowser, STORAGE_ROOT, selectorsRegistry, storageProvider } from "./shared/env.ts";
import { log, title } from "./shared/helpers.ts";

const engine = createBrowserEngine({ provider: localBrowser })
    .use(selectors({ registry: selectorsRegistry }))
    .use(storage({ provider: storageProvider }));

type AppShape = Compose<[BrowserShape, SelectorsShape, StorageShape]>;

const PREFIX = "03-storage/";
const DASHBOARD_URL_PATTERN = /\/dashboard/;

// ── Flow 1: save() bytes + saveStream() from a Playwright download ──

const captureFlow = flow<AppShape>("capture").nodes(({ task }) => [
    task({
        name: "sign-in",
        run: async (context) => {
            // The download demo below targets /dashboard/reports, which
            // requires a session. Log in once at the start of the flow.
            await context.navigate(`${BASE_URL}/login`);
            const user = await context.selectors.resolve("loginUser", context.page);
            const pass = await context.selectors.resolve("loginPass", context.page);
            const submit = await context.selectors.resolve("loginSubmit", context.page);
            await user.fill("acme");
            await pass.fill("acme");
            await submit.click();
            await context.page.waitForURL(DASHBOARD_URL_PATTERN);
        },
    }),
    task({
        name: "save-screenshot",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/`);
            const screenshot = await context.page.screenshot();
            const result = await context.storage.save(`${PREFIX}home.png`, new Uint8Array(screenshot), {
                page: "home",
                source: "screenshot",
            });
            context.log.info(`saved ${result.size} bytes -> ${result.location.value}`);
        },
    }),

    task({
        name: "save-synthetic-stream",
        run: async (context) => {
            // Build any ReadableStream<Uint8Array>; this stands in for any
            // upstream chunked source (HTTP body, file pipe, transform, etc).
            const encoder = new TextEncoder();
            const lines = ["row,value\n", "alpha,1\n", "beta,2\n", "gamma,3\n"];
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    for (const line of lines) {
                        controller.enqueue(encoder.encode(line));
                    }
                    controller.close();
                },
            });
            const result = await context.storage.saveStream(`${PREFIX}sample.csv`, stream);
            context.log.info(`stream saved: ${result.key} (${result.size} bytes)`);
        },
    }),

    task({
        name: "save-download-via-stream",
        run: async (context) => {
            // Real-world: capture a download from the test app and pipe it
            // into the StorageProvider without buffering through memory.
            //
            // The reports page generates via SSE: clicking "Generate" starts
            // a progress stream and only renders the `report-download` link
            // when the stream completes. The actual download event fires
            // when that link is clicked.
            await context.navigate(`${BASE_URL}/dashboard/reports`);
            await context.page.click("[data-testid='generate-btn']");
            await context.page.waitForSelector("[data-testid='report-download']", { timeout: 30_000 });

            const [download] = await Promise.all([
                context.page.waitForEvent("download"),
                context.page.click("[data-testid='report-download']"),
            ]);

            const readable = await download.createReadStream();
            if (!readable) {
                throw new Error("download stream not available");
            }
            const webStream = Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array>;

            const result = await context.storage.saveStream(
                `${PREFIX}downloads/${download.suggestedFilename()}`,
                webStream,
                { source: "playwright-download" }
            );
            context.log.info(`download captured: ${result.key} (${result.size} bytes)`);
        },
    }),
]);

title("1 - save() and saveStream() under the engine's storage");
const r1 = await engine.run(captureFlow);
log(`status: ${r1.status}`);

// ── Flow 2: list / head / exists / read / readStream / delete ───────

const queryFlow = flow<AppShape>("query-storage").nodes(({ task }) => [
    task({
        name: "list-and-head",
        run: async (context) => {
            // list(prefix?, cursor?, limit?) — cursor-paginated.
            const page = await context.storage.list(PREFIX);
            context.log.info(`keys under ${PREFIX}:`);
            for (const key of page.keys) {
                const info = await context.storage.head(key);
                context.log.info(`  ${key}  size=${info.size}  modified=${info.modifiedAt.toISOString()}`);
            }
            if (page.nextCursor) {
                context.log.info(`(more pages available; nextCursor=${page.nextCursor})`);
            }
        },
    }),

    task({
        name: "read-and-readStream",
        run: async (context) => {
            const exists = await context.storage.exists(`${PREFIX}home.png`);
            context.log.info(`home.png exists: ${exists}`);

            const bytes = await context.storage.read(`${PREFIX}sample.csv`);
            const text = new TextDecoder().decode(bytes);
            context.log.info(`sample.csv (${bytes.byteLength}B): ${text.split("\n")[0]}...`);

            // Streaming read: useful for large files we do not want to buffer.
            const stream = await context.storage.readStream(`${PREFIX}sample.csv`);
            let total = 0;
            for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
                total += chunk.byteLength;
            }
            context.log.info(`stream read total bytes: ${total}`);
        },
    }),

    task({
        name: "delete-and-list-again",
        run: async (context) => {
            await context.storage.delete(`${PREFIX}home.png`);
            const stillThere = await context.storage.exists(`${PREFIX}home.png`);
            context.log.info(`after delete, home.png exists: ${stillThere}`);
        },
    }),
]);

title("2 - list / head / exists / read / readStream / delete");
const r2 = await engine.run(queryFlow);
log(`status: ${r2.status}`);
log(`storage root: ${STORAGE_ROOT}`);

await localBrowser.dispose();
