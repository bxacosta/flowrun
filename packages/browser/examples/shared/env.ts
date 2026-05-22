import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorageProvider, JsonSelectorRegistry, LocalBrowserProvider } from "@flowrun/browser";

/**
 * Base URL for the local test app described in
 * packages/browser/docs/test-app-spec.md. Override with TEST_APP_URL.
 */
// biome-ignore lint/complexity/useLiteralKeys: TS strict mode requires bracket access for env index signature
export const BASE_URL = process.env["TEST_APP_URL"] ?? "http://localhost:5173";

/**
 * Shared provider for the examples. Lazy: chromium is not launched until
 * the first run() call hits provider.open(). Set HEADLESS=0 to watch.
 */
export const provider = new LocalBrowserProvider({
    // biome-ignore lint/complexity/useLiteralKeys: TS strict mode requires bracket access for env index signature
    headless: process.env["HEADLESS"] !== "0",
});

/**
 * Selector registry built inline. Mirrors the markup contract listed in
 * test-app-spec.md sections 4 and 5. The fields used by each example
 * are scoped per page; expand as the test app grows.
 */
export const selectors = JsonSelectorRegistry.fromObject({
    pageTitle: { selector: "[data-testid='page-title']", description: "Page-unique heading" },
    loginUser: { selector: "[name='username']" },
    loginPass: { selector: "[name='password']" },
    loginSubmit: { selector: "[data-testid='login-submit']" },
    loginError: { selector: "[data-testid='login-error']" },
    invoiceRow: { selector: "[data-testid='invoice-row']" },
    invoiceStatusFilter: { selector: "[data-testid='invoice-status-filter']" },
    invoiceSearch: { selector: "[data-testid='invoice-search']" },
    downloadPdf: { selector: "[data-testid='download-pdf']" },
    paymentFrame: { selector: "[data-testid='payment-frame']" },
    paymentCardNumber: { selector: "[name='cardNumber']" },
    paymentExpiry: { selector: "[name='expiry']" },
    paymentCvv: { selector: "[name='cvv']" },
    reportGenerate: { selector: "[data-testid='report-generate']" },
    reportProgress: { selector: "[data-testid='report-progress']" },
    reportDownload: { selector: "[data-testid='report-download']" },
    twoFactorCode: { selector: "[name='code']" },
});

/**
 * Shared storage root under the OS temp directory. Each example writes
 * under a sub-prefix so listings stay isolated.
 */
export const STORAGE_ROOT = join(tmpdir(), "flowrun-browser-examples");

export const storage = new FileStorageProvider(STORAGE_ROOT);
