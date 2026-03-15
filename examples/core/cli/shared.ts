import type { Middleware } from "@flowrun/core";

export interface CliImportParams {
    interactive: boolean;
    source: string;
}

export interface CliImportState {
    audit: string[];
    batches?: string[];
    downloadedCustomers?: boolean;
    downloadedInvoices?: boolean;
    downloadedOrders?: boolean;
    manifestReady?: boolean;
    transformedCustomers?: boolean;
    transformedInvoices?: boolean;
    transformedOrders?: boolean;
    uploadedCustomers?: boolean;
    uploadedInvoices?: boolean;
    uploadedOrders?: boolean;
    validatedCustomers?: boolean;
    validatedInvoices?: boolean;
    validatedOrders?: boolean;
}

type Batch = "customers" | "orders" | "invoices";
type Stage = "downloaded" | "validated" | "transformed" | "uploaded";

const STAGE_KEYS: Record<Stage, Record<Batch, keyof CliImportState>> = {
    downloaded: {
        customers: "downloadedCustomers",
        orders: "downloadedOrders",
        invoices: "downloadedInvoices",
    },
    validated: {
        customers: "validatedCustomers",
        orders: "validatedOrders",
        invoices: "validatedInvoices",
    },
    transformed: {
        customers: "transformedCustomers",
        orders: "transformedOrders",
        invoices: "transformedInvoices",
    },
    uploaded: {
        customers: "uploadedCustomers",
        orders: "uploadedOrders",
        invoices: "uploadedInvoices",
    },
};

export function appendAudit(
    state: { snapshot(): Readonly<CliImportState>; set(key: "audit", value: string[]): void },
    entry: string
): void {
    state.set("audit", [...state.snapshot().audit, entry]);
}

export function markBatchStage(
    state: {
        set<K extends keyof CliImportState>(key: K, value: CliImportState[K]): void;
    },
    batch: Batch,
    stage: Stage
): void {
    const key = STAGE_KEYS[stage][batch];
    state.set(key, true);
}

export function countUploadedBatches(state: Readonly<CliImportState>): number {
    return [state.uploadedCustomers, state.uploadedOrders, state.uploadedInvoices].filter(Boolean).length;
}

export const timingMiddleware: Middleware<CliImportParams, CliImportState> = async (ctx, next) => {
    const startedAt = Date.now();
    await next();
    ctx.log.info("Step timing", {
        step: ctx.step.name,
        durationMs: Date.now() - startedAt,
    });
};
