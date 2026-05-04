export type SessionStatus = "completed" | "active" | "error" | "cancelled" | "idle";

export const SESSION_STATUSES: SessionStatus[] = ["completed", "active", "error", "cancelled", "idle"];

export type SessionStatusBreakdown = Record<SessionStatus, number>;

export interface AgentListItem {
  id: string;
  name: string;
  model: string;
  ownerName: string;
  ownerAvatar?: string;
  sessions: number;
  lastUsedIso?: string;
  isDefault?: boolean;
  statusBreakdown: SessionStatusBreakdown;
}

export interface AgentsListSummary {
  agents: AgentListItem[];
  rangeLabel: string;
  inferenceMetricsAvailable: boolean;
}
