/**
 * 02-selectors.ts — SelectorRegistry, JsonSelectorRegistry, LocatorScope
 *
 * Covers:
 *  - JsonSelectorRegistry.fromObject({ name: { selector, description?, timeout? } })
 *  - JsonSelectorRegistry.load(filePath) — read definitions from disk
 *  - registry.get(name) -> SelectorDefinition (throws SelectorNotFoundError)
 *  - registry.resolve(name, scope) -> Locator
 *  - LocatorScope = Page | Locator | Frame
 *  - SelectorNotFoundError
 *  - registry.reload() — reread the source file after edits (no-op for fromObject)
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    type BrowserShape,
    type Compose,
    createBrowserEngine,
    JsonSelectorRegistry,
    SelectorNotFoundError,
    type SelectorRegistry,
    type SelectorsShape,
    selectors,
} from "@flowrun/browser";
import { flow } from "@flowrun/core";
import { BASE_URL, localBrowser } from "./shared/env.ts";
import { log, title } from "./shared/helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const DASHBOARD_URL_PATTERN = /\/dashboard/;

// ── Inline registry — handy for tests and small flows ───────────────

const inlineRegistry = JsonSelectorRegistry.fromObject({
    pageTitle: { selector: "[data-testid='page-title']", description: "Page-unique heading" },
    loginUser: { selector: "[name='username']" },
    loginPass: { selector: "[name='password']" },
    loginSubmit: { selector: "[data-testid='login-submit']" },
    loginError: { selector: "[data-testid='login-error']" },
    paymentFrame: { selector: "[data-testid='payment-frame']" },
    paymentCardNumber: { selector: "[name='cardNumber']" },
});

const engine = createBrowserEngine({ provider: localBrowser }).use(selectors({ registry: inlineRegistry }));

type AppShape = Compose<[BrowserShape, SelectorsShape]>;

// ── Demo 1: registry.get(name) — read a SelectorDefinition ──────────

title("1 - registry.get(name) returns a SelectorDefinition");
const titleDef = inlineRegistry.get("pageTitle");
log(`selector: ${titleDef.selector}`);
log(`description: ${titleDef.description ?? "(none)"}`);

// ── Demo 2: resolve against the Page scope (top-level locators) ─────

const loginFlow = flow<AppShape>("selectors-page-scope").nodes(({ task }) => [
    task({
        name: "fill-login",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/login`);

            // Each resolve(name, scope) -> Locator. scope = Page here.
            const user = await context.selectors.resolve("loginUser", context.page);
            const pass = await context.selectors.resolve("loginPass", context.page);
            const submit = await context.selectors.resolve("loginSubmit", context.page);

            await user.fill("lockout");
            await pass.fill("nope");
            await submit.click();

            // Resolve against the same scope to assert an error appeared.
            const error = await context.selectors.resolve("loginError", context.page);
            const message = await error.textContent();
            context.log.info(`error displayed: ${message ?? "(empty)"}`);
        },
    }),
]);

title("2 - resolve(name, page) for top-level selectors");
const r2 = await engine.run(loginFlow);
log(`status: ${r2.status}`);

// ── Demo 3: resolve against a Frame scope (iframe content) ──────────

const iframeFlow = flow<AppShape>("selectors-frame-scope").nodes(({ task }) => [
    task({
        name: "sign-in",
        run: async (context) => {
            // /dashboard/* requires a session; log in with the seeded acme account
            // before navigating to the page that hosts the payment iframe.
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
        name: "fill-payment-widget",
        run: async (context) => {
            await context.navigate(`${BASE_URL}/dashboard/invoices/1/pay`);

            // Wait for the iframe to be present, then locate the Frame.
            await context.page.waitForSelector("[data-testid='payment-frame']");
            const frame = context.page.frames().find((candidate) => candidate.url().includes("/widgets/payment"));
            if (!frame) {
                throw new Error("payment frame not attached yet");
            }

            // LocatorScope accepts Frame — resolve runs scope.locator(selector).
            const cardNumber = await context.selectors.resolve("paymentCardNumber", frame);
            await cardNumber.fill("4111 1111 1111 1111");
            context.log.info("filled card number inside iframe");
        },
    }),
]);

title("3 - resolve(name, frame) for selectors inside an iframe");
const r3 = await engine.run(iframeFlow);
log(`status: ${r3.status}`);

// ── Demo 4: typed keys at compile time + runtime guard for dynamic names ─

title("4 - typed keys reject typos; runtime guard covers dynamic names");

// fromObject() infers the key union: inlineRegistry.get("doesNotExist") is a
// compile error. Widening to SelectorRegistry models a name only known at runtime,
// where the registry still guards via SelectorNotFoundError.
const dynamicRegistry: SelectorRegistry = inlineRegistry;
const requestedName = "doesNotExist";
try {
    dynamicRegistry.get(requestedName);
} catch (error) {
    if (error instanceof SelectorNotFoundError) {
        log(`caught: ${error.message}`);
    } else {
        throw error;
    }
}

// ── Demo 5: load definitions from a JSON file + reload() ────────────

title("5 - JsonSelectorRegistry.load(file) and registry.reload()");
const filePath = join(HERE, "shared/selectors.json");
const fileRegistry = await JsonSelectorRegistry.load(filePath);
log(`loaded 'twoFactorCode' from file: ${fileRegistry.get("twoFactorCode").selector}`);

// reload() rereads the source file. fromObject registries have no source,
// so reload() is a safe no-op there.
await fileRegistry.reload();
log("reload() completed");

await localBrowser.dispose();
