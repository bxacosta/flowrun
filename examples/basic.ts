import { defineFlow, FlowEngine } from "../src";
import { ConsoleReporter } from "./shared/reporter.ts";

interface SyncUserParams {
    includeAudit: boolean;
    userId: string;
}

interface SyncUserState {
    auditTrail?: string[];
    saved?: boolean;
    user?: { id: string; name: string; active: boolean };
}

const syncUserFlow = defineFlow<SyncUserParams, SyncUserState>({
    id: "sync-user",
    name: "Sync User",
    initialState: {
        auditTrail: [],
    },
    build: ({ step }) => [
        step("fetch-user", async (ctx) => {
            ctx.log.info("Fetching user", { userId: ctx.params.userId });
            ctx.state.set("user", {
                id: ctx.params.userId,
                name: "Ada Lovelace",
                active: true,
            });
        }),
        step("validate-user", async (ctx) => {
            const user = ctx.state.get("user");
            if (!user) {
                throw new Error("User was not loaded");
            }

            if (!user.active) {
                ctx.stop("User is inactive");
            }

            if (ctx.params.includeAudit) {
                const audit = [...(ctx.state.get("auditTrail") ?? [])];
                audit.push(`validated:${user.id}`);
                ctx.state.set("auditTrail", audit);
            }
        }),
        step("save-user", async (ctx) => {
            const user = ctx.state.get("user");
            ctx.log.info("Saving user", { userId: user?.id });
            ctx.state.set("saved", true);
        }),
    ],
    onSuccess: async (ctx, result) => {
        ctx.log.info("Flow completed", {
            status: result.status,
            steps: result.steps.length,
        });
    },
});

const engine = new FlowEngine({
    reporter: new ConsoleReporter(),
});

const result = await engine.run(syncUserFlow, {
    userId: "user-42",
    includeAudit: true,
});

console.log("\nResult state:");
console.log(result.state);
