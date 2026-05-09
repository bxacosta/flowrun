import type { MaybePromise } from "./utils.ts";

export type RequestStatus = "cancelled" | "expired" | "pending" | "responded";
export type TerminalRequestStatus = Exclude<RequestStatus, "pending">;

export function isTerminalStatus(status: RequestStatus): status is TerminalRequestStatus {
    return status === "cancelled" || status === "expired" || status === "responded";
}

export interface RequestRecord<TPayload = unknown, TResponse = unknown> {
    readonly attempt?: number;
    readonly cancelledAt?: number;
    readonly createdAt: number;
    readonly expiredAt?: number;
    readonly flowName: string;
    readonly id: string;
    readonly iteration?: { index: number; item: unknown };
    readonly key?: string;
    readonly metadata?: Record<string, unknown>;
    readonly name: string;
    readonly nodeName?: string;
    readonly path: readonly string[];
    readonly payload: TPayload;
    readonly reason?: string;
    readonly respondedAt?: number;
    readonly response?: TResponse;
    readonly responseMetadata?: Record<string, unknown>;
    readonly runId: string;
    readonly status: RequestStatus;
    readonly timeoutAt?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased record for runtime registries
export type AnyRequestRecord = RequestRecord<any, any>;

export type RequestRedact = (record: AnyRequestRecord) => AnyRequestRecord;

export interface RequestDefinition<TPayload, TResponse> {
    readonly _payload?: TPayload;
    readonly _response?: TResponse;
    readonly kind: "request";
    readonly name: string;
    readonly redact?: RequestRedact;
}

// biome-ignore lint/suspicious/noExplicitAny: type-erased definition for runtime registries
export type AnyRequestDefinition = RequestDefinition<any, any>;

export interface RequestConfig<TPayload, TResponse> {
    name: string;
    redact?: (record: RequestRecord<TPayload, TResponse>) => RequestRecord<TPayload, TResponse>;
}

export interface RequestOptions {
    key?: string;
    metadata?: Record<string, unknown>;
    timeout?: number;
}

export interface RequestResponseOptions {
    metadata?: Record<string, unknown>;
}

export interface PendingRequest<TPayload, TResponse> {
    cancel(reason?: string): Promise<void>;
    readonly flowName: string;
    readonly id: string;
    readonly iteration?: { index: number; item: unknown };
    readonly key?: string;
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

export function defineRequest<TPayload, TResponse>(
    config: RequestConfig<TPayload, TResponse>
): RequestDefinition<TPayload, TResponse> {
    return {
        kind: "request",
        name: config.name,
        redact: config.redact as RequestRedact | undefined,
    };
}
