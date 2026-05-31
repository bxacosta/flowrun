/**
 * core/errors.ts — Base error type and normalization
 *
 * Layer: L0 (core). No internal dependencies. Domain-specific errors live with
 * their concern (e.g. request errors in definition/request, merge errors in
 * state/errors) and all extend {@link FlowEngineError}.
 */

export class FlowEngineError extends Error {
    override readonly name: string = "FlowEngineError";
}

export function normalizeError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error), { cause: error });
}
