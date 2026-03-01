import {defineFlow, parallel, sequence} from "../../src";
import {
    bootstrapStep,
    buildManifestStep,
    makeDownloadStep,
    makeTransformStep,
    makeUploadStep,
    makeValidateStep,
} from "./steps.ts";
import {
    appendAudit,
    countUploadedBatches,
    timingMiddleware,
    type CliImportParams,
    type CliImportState,
} from "./shared.ts";

const batchPipelines = ["customers", "orders", "invoices"].map((batch) =>
    sequence(`pipeline-${batch}`, [
        makeDownloadStep(batch),
        makeValidateStep(batch),
        makeTransformStep(batch),
        makeUploadStep(batch),
    ], {
        name: `Pipeline ${batch}`,
    }),
);

export const cliImportFlow = defineFlow<CliImportParams, CliImportState>({
    id: "cli-import",
    name: "CLI Import Demo",
    initialState: {
        audit: [],
    },
    middleware: [timingMiddleware],
    steps: [
        bootstrapStep,
        parallel("run-batch-pipelines", batchPipelines, {
            name: "Run Batch Pipelines",
            concurrency: 2,
            mode: "all-settled",
        }),
        buildManifestStep,
    ],
    onStart: async (ctx) => {
        appendAudit(ctx.state, "flow-started");
        ctx.log.info("CLI demo started", {
            source: ctx.params.source,
            interactive: ctx.params.interactive,
        });
    },
    onSuccess: async (ctx, result) => {
        appendAudit(ctx.state, "flow-succeeded");
        ctx.log.info("CLI demo finished", {
            status: result.status,
            uploadedBatches: countUploadedBatches(result.state),
        });
    },
    onComplete: async (ctx, result) => {
        appendAudit(ctx.state, `flow-complete:${result.status}`);
    },
});
