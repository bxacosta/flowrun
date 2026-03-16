import { defineFlow, FlowEngine } from "@flowrun/core";
import { consoleSubscriber } from "./shared/reporter.ts";

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
        step("fetch-user", (ctx) => {
            ctx.emit("log", {
                level: "info",
                message: "Fetching user",
                data: {
                    userId: ctx.params.userId,
                },
            });
            ctx.state.set("user", {
                id: ctx.params.userId,
                name: "Ada Lovelace",
                active: true,
            });
        }),
        step("validate-user", (ctx) => {
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
        step("save-user", (ctx) => {
            const user = ctx.state.get("user");
            ctx.emit("log", {
                level: "info",
                message: "Saving user",
                data: {
                    userId: user?.id,
                },
            });
            ctx.state.set("saved", true);
        }),
    ],
    onSuccess: (ctx, result) => {
        ctx.emit("log", {
            level: "info",
            message: "Flow completed",
            data: {
                status: result.status,
                steps: result.steps.length,
            },
        });
    },
});

const engine = new FlowEngine({
    subscribers: [consoleSubscriber],
});

const result = await engine.run(syncUserFlow, {
    userId: "user-42",
    includeAudit: true,
});

console.log("\nResult state:");
console.log(result.state);
