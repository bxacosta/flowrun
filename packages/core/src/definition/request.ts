/**
 * definition/request.ts — Request definitions, types & errors
 *
 * Layer: L3 (definition). A request is a portable typed token for
 * human-in-the-loop / external interactions. This module owns the request
 * error hierarchy it can produce at runtime.
 */

import { FlowEngineError } from "../core/errors.ts";
import type { IterationContext, MaybePromise } from "../core/types.ts";
import { assertValidName } from "../core/validation.ts";

// ── Status ──────────────────────────────────────────────────────────

export type RequestStatus = "cancelled" | "expired" | "pending" | "resolved";
export type TerminalRequestStatus = Exclude<RequestStatus, "pending">;

export function isTerminalStatus(status: RequestStatus): status is TerminalRequestStatus {
    return status === "cancelled" || status === "expired" || status === "resolved";
}

// ── Records & definitions ───────────────────────────────────────────

export interface RequestRecord<TPayload = unknown, TResponse = unknown> {
    readonly attempt?: number;
    readonly cancelledAt?: number;
    readonly createdAt: number;
    readonly expiredAt?: number;
    readonly expiresAt?: number;
    readonly flowName: string;
    readonly id: string;
    readonly idempotencyKey?: string;
    readonly iteration?: IterationContext;
    readonly metadata?: Record<string, unknown>;
    readonly name: string;
    readonly nodeName?: string;
    readonly path: readonly string[];
    readonly payload: TPayload;
    readonly reason?: string;
    readonly resolvedAt?: number;
    readonly response?: TResponse;
    readonly responseMetadata?: Record<string, unknown>;
    readonly runId: string;
    readonly status: RequestStatus;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased record for runtime registries
export type AnyRequestRecord = RequestRecord<any, any>;

export type RequestRedact = (record: AnyRequestRecord) => AnyRequestRecord;

export interface RequestDefinition<TPayload, TResponse> {
    readonly _payload?: TPayload;
    readonly _response?: TResponse;
    readonly name: string;
    readonly redact?: RequestRedact;
    readonly type: "request";
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased definition for runtime registries
export type AnyRequestDefinition = RequestDefinition<any, any>;

export interface RequestConfig<TPayload, TResponse> {
    name: string;
    redact?: (record: RequestRecord<TPayload, TResponse>) => RequestRecord<TPayload, TResponse>;
}

export interface RequestOptions {
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    timeoutMs?: number;
}

export interface RequestResponseOptions {
    metadata?: Record<string, unknown>;
}

export interface PendingRequest<TPayload, TResponse> {
    cancel(reason?: string): Promise<void>;
    readonly flowName: string;
    readonly id: string;
    readonly idempotencyKey?: string;
    readonly iteration?: IterationContext;
    readonly metadata?: Record<string, unknown>;
    readonly name: string;
    readonly nodeName?: string;
    readonly path: readonly string[];
    readonly payload: TPayload;
    respond(response: TResponse, options?: RequestResponseOptions): Promise<void>;
    readonly runId: string;
    readonly signal: AbortSignal;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased pending request for runtime dispatch
export type AnyPendingRequest = PendingRequest<any, any>;

export interface RequestFilter {
    flowName?: string;
    name?: string;
    runId?: string;
    status?: RequestStatus;
}

export type RequestCreatedHandler<TPayload, TResponse> = (
    request: PendingRequest<TPayload, TResponse>
) => MaybePromise<void>;

// biome-ignore lint/suspicious/noExplicitAny: type-erased handler for runtime dispatch
export type AnyRequestCreatedHandler = RequestCreatedHandler<any, any>;

export interface RequestSubscribeOptions {
    replayPending?: boolean;
}

export interface RequestSubscription {
    unsubscribe(): void;
}

export type ContextRequest = <TPayload, TResponse>(
    definition: RequestDefinition<TPayload, TResponse>,
    payload: TPayload,
    options?: RequestOptions
) => Promise<TResponse>;

export interface EngineRequests {
    cancel(id: string, reason?: string): Promise<void>;
    get(id: string): AnyRequestRecord | undefined;
    list(filter?: RequestFilter): readonly AnyRequestRecord[];
    on<TPayload, TResponse>(
        definition: RequestDefinition<TPayload, TResponse>,
        handler: RequestCreatedHandler<TPayload, TResponse>,
        options?: RequestSubscribeOptions
    ): RequestSubscription;
    respond<TPayload, TResponse>(
        definition: RequestDefinition<TPayload, TResponse>,
        id: string,
        response: TResponse,
        options?: RequestResponseOptions
    ): Promise<void>;
}

// ── Errors ──────────────────────────────────────────────────────────

export class RequestError extends FlowEngineError {
    override readonly name: string = "RequestError";
    readonly requestId: string | undefined;
    readonly requestName: string | undefined;

    constructor(message: string, options?: { requestId?: string; requestName?: string }) {
        super(message);
        this.requestId = options?.requestId;
        this.requestName = options?.requestName;
    }
}

export class RequestExpiredError extends RequestError {
    override readonly name = "RequestExpiredError";
    readonly timeoutMs: number;

    constructor(requestName: string, requestId: string, timeoutMs: number) {
        super(`Request "${requestName}" expired after ${timeoutMs}ms`, { requestId, requestName });
        this.timeoutMs = timeoutMs;
    }
}

export class RequestCancelledError extends RequestError {
    override readonly name = "RequestCancelledError";
    readonly reason: string | undefined;

    constructor(requestName: string, requestId: string, reason?: string) {
        super(reason ? `Request "${requestName}" cancelled: ${reason}` : `Request "${requestName}" cancelled`, {
            requestId,
            requestName,
        });
        this.reason = reason;
    }
}

export class RequestNotFoundError extends RequestError {
    override readonly name = "RequestNotFoundError";

    constructor(requestId: string) {
        super(`Request "${requestId}" not found`, { requestId });
    }
}

export class RequestAlreadySettledError extends RequestError {
    override readonly name = "RequestAlreadySettledError";
    readonly currentStatus: TerminalRequestStatus;

    constructor(requestName: string, requestId: string, currentStatus: TerminalRequestStatus) {
        super(`Request "${requestName}" is already ${currentStatus}`, { requestId, requestName });
        this.currentStatus = currentStatus;
    }
}

// ── Factory ─────────────────────────────────────────────────────────

export function request<TPayload, TResponse>(
    config: RequestConfig<TPayload, TResponse>
): RequestDefinition<TPayload, TResponse> {
    assertValidName("request", config.name);
    return {
        type: "request",
        name: config.name,
        redact: config.redact as RequestRedact | undefined,
    };
}
