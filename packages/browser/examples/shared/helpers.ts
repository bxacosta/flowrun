// ── Logging ─────────────────────────────────────────────────────────

export function log(message: string, ...args: unknown[]): void {
    console.log(message, ...args);
}

export function title(heading: string): void {
    console.log(`\n=== ${heading} ===\n`);
}
