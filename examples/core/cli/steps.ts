import { type StepNode, step } from "@flowrun/core";
import { sleep } from "../shared/runtime.ts";
import { appendAudit, type CliImportParams, type CliImportState, markBatchStage } from "./shared.ts";

export const bootstrapStep: StepNode<CliImportParams, CliImportState> = step("bootstrap-run", async (ctx) => {
    ctx.emit("log", { level: "info", message: "Preparing import session", data: { source: ctx.params.source } });
    await sleep(700, ctx.signal);
    ctx.state.set("batches", ["customers", "orders", "invoices"]);
    appendAudit(ctx.state, "bootstrapped");
});

export function makeDownloadStep(batch: string): StepNode<CliImportParams, CliImportState> {
    return step(`download-${batch}`, async (ctx) => {
        ctx.emit("log", { level: "info", message: "Downloading batch", data: { batch } });
        await sleep(1800, ctx.signal);
        markBatchStage(ctx.state, batch as "customers" | "orders" | "invoices", "downloaded");
    });
}

export function makeValidateStep(batch: string): StepNode<CliImportParams, CliImportState> {
    return step(`validate-${batch}`, async (ctx) => {
        ctx.emit("log", { level: "info", message: "Validating batch", data: { batch } });
        await sleep(1200, ctx.signal);
        markBatchStage(ctx.state, batch as "customers" | "orders" | "invoices", "validated");
    });
}

export function makeTransformStep(batch: string): StepNode<CliImportParams, CliImportState> {
    return step(`transform-${batch}`, async (ctx) => {
        ctx.emit("log", { level: "info", message: "Transforming batch", data: { batch } });
        await sleep(1500, ctx.signal);
        markBatchStage(ctx.state, batch as "customers" | "orders" | "invoices", "transformed");
    });
}

export function makeUploadStep(batch: string): StepNode<CliImportParams, CliImportState> {
    return step(
        `upload-${batch}`,
        async (ctx) => {
            ctx.emit("log", { level: "info", message: "Uploading batch", data: { batch } });
            await sleep(1600, ctx.signal);
            markBatchStage(ctx.state, batch as "customers" | "orders" | "invoices", "uploaded");
        },
        {
            retry: {
                attempts: 2,
                delayMs: 300,
                strategy: "exponential",
            },
        }
    );
}

export const buildManifestStep: StepNode<CliImportParams, CliImportState> = step("build-manifest", async (ctx) => {
    ctx.emit("log", { level: "info", message: "Building final manifest" });
    await sleep(900, ctx.signal);
    ctx.state.set("manifestReady", true);
    appendAudit(ctx.state, "manifest-ready");
});
