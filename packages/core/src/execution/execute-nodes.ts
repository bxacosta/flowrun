import { executeParallel } from "./execute-parallel.ts";
import { executeTask } from "./execute-task.ts";
import type { ExecutionContext, NodeExecutionOutcome } from "./execution-types.ts";
import type { ResolvedNode } from "./resolver.ts";

export const executeNodes = async (
    context: ExecutionContext,
    nodes: readonly ResolvedNode[]
): Promise<NodeExecutionOutcome> => {
    for (const node of nodes) {
        await context.runController.waitForNextNode();

        if (context.runController.isCancelled) {
            return {};
        }

        if (context.runController.isStopped) {
            return { stopReason: context.runController.stopReason };
        }

        if (node.kind === "task") {
            const outcome = await executeTask(context, node.definition);

            if (outcome.status === "failed") {
                return { error: outcome.error };
            }

            if (outcome.stopReason !== undefined) {
                return { stopReason: outcome.stopReason };
            }

            continue;
        }

        const outcome = await executeParallel(context, node);

        if (outcome.error !== undefined) {
            return outcome;
        }

        if (outcome.stopReason !== undefined) {
            return outcome;
        }
    }

    return {};
};
