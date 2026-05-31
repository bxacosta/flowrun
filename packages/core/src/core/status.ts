/**
 * core/status.ts — Flow lifecycle status
 *
 * Layer: L0 (core). No internal dependencies.
 */

export type FlowStatus = "cancelled" | "failed" | "paused" | "pending" | "running" | "success";

export type TerminalFlowStatus = Extract<FlowStatus, "cancelled" | "failed" | "success">;
