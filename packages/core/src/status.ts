export type FlowStatus = "cancelled" | "failed" | "paused" | "pending" | "running" | "success";

export type TerminalFlowStatus = Extract<FlowStatus, "cancelled" | "failed" | "success">;
