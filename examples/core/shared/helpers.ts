// ── Async Simulation ────────────────────────────────────────────────

export async function simulateWork(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── ANSI Colors ─────────────────────────────────────────────────────

export const COLORS = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
} as const;

export type Color = keyof typeof COLORS;

export function colorize(color: Color, text: string): string {
    return `${COLORS[color]}${text}${COLORS.reset}`;
}

// ── Logging ─────────────────────────────────────────────────────────

export function log(message: string, ...args: unknown[]): void {
    console.log(message, ...args);
}

export function title(heading: string): void {
    console.log(`\n=== ${heading} ===\n`);
}

// ── Simulated Browser ───────────────────────────────────────────────

export interface Page {
    close(): Promise<void>;
    closed: boolean;
    content(): string;
    goto(url: string): Promise<void>;
    id: number;
}

export interface Browser {
    newPage(): Promise<Page>;
}

export function createBrowser(): Browser {
    let nextPageId = 1;

    return {
        newPage(): Promise<Page> {
            const id = nextPageId++;
            log(`  [browser] page #${id} opened`);
            const page: Page = {
                close() {
                    this.closed = true;
                    log(`  [page #${id}] closed`);
                    return Promise.resolve();
                },
                closed: false,
                content() {
                    return `<html lang="en">data from page #${id}</html>`;
                },
                async goto(url: string) {
                    log(`  [page #${id}] navigating to ${url}`);
                    await delay(30);
                },
                id,
            };
            return Promise.resolve(page);
        },
    };
}
