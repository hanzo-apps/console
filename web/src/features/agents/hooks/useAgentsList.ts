import { useMemo } from "react";
import {
  type AgentListItem,
  type AgentsListSummary,
  SESSION_STATUSES,
  type SessionStatus,
  type SessionStatusBreakdown,
} from "../types/agents-list";
import type { AgentHealthItem } from "../types/dashboard";
import { useEnhancedDashboard } from "./useEnhancedDashboard";

const STATUS_TO_LIFECYCLE: Record<string, SessionStatus> = {
  running: "active",
  active: "active",
  succeeded: "completed",
  completed: "completed",
  failed: "error",
  error: "error",
  cancelled: "cancelled",
  canceled: "cancelled",
  idle: "idle",
  pending: "idle",
};

function inferStatus(item: AgentHealthItem): SessionStatus {
  return (
    STATUS_TO_LIFECYCLE[item.health?.toLowerCase() ?? ""] ??
    STATUS_TO_LIFECYCLE[item.status?.toLowerCase() ?? ""] ??
    STATUS_TO_LIFECYCLE[item.lifecycle?.toLowerCase() ?? ""] ??
    "idle"
  );
}

function emptyBreakdown(): SessionStatusBreakdown {
  return SESSION_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {} as SessionStatusBreakdown);
}

interface UseAgentsListOptions {
  preset?: "1h" | "24h" | "7d" | "30d";
}

export function useAgentsList(options: UseAgentsListOptions = {}) {
  const { preset = "24h" } = options;
  const { data, loading, error, refresh, isRefreshing } = useEnhancedDashboard({
    preset,
  });

  const summary = useMemo<AgentsListSummary | null>(() => {
    if (!data) return null;

    const agentMeta = new Map<string, AgentHealthItem>(data.agent_health.agents.map((agent) => [agent.id, agent]));

    const breakdownByAgent = new Map<string, SessionStatusBreakdown>();
    const sessionsByAgent = new Map<string, number>();
    const lastUsedByAgent = new Map<string, string | undefined>();

    const ensure = (agentId: string) => {
      if (!breakdownByAgent.has(agentId)) {
        breakdownByAgent.set(agentId, emptyBreakdown());
        sessionsByAgent.set(agentId, 0);
        lastUsedByAgent.set(agentId, agentMeta.get(agentId)?.last_heartbeat);
      }
    };

    data.agent_health.agents.forEach((agent) => ensure(agent.id));

    data.workflows.active_runs.forEach((run) => {
      if (!run.agent_node_id) return;
      ensure(run.agent_node_id);
      const breakdown = breakdownByAgent.get(run.agent_node_id)!;
      breakdown.active += 1;
      sessionsByAgent.set(run.agent_node_id, (sessionsByAgent.get(run.agent_node_id) ?? 0) + 1);
      const prev = lastUsedByAgent.get(run.agent_node_id);
      if (!prev || run.started_at > prev) {
        lastUsedByAgent.set(run.agent_node_id, run.started_at);
      }
    });

    data.incidents.forEach((incident) => {
      if (!incident.agent_node_id) return;
      ensure(incident.agent_node_id);
      const breakdown = breakdownByAgent.get(incident.agent_node_id)!;
      breakdown.error += 1;
    });

    const agents: AgentListItem[] = Array.from(breakdownByAgent.entries()).map(([agentId, breakdown]) => {
      const meta = agentMeta.get(agentId);
      const sessions = SESSION_STATUSES.reduce((sum, status) => sum + breakdown[status], 0);
      const fallbackStatus = meta ? inferStatus(meta) : "idle";
      if (sessions === 0) {
        breakdown[fallbackStatus] = 1;
      }
      return {
        id: agentId,
        name: agentId,
        model: meta?.version ?? "unknown",
        ownerName: meta?.team_id ?? "—",
        sessions: sessions === 0 ? 1 : sessions,
        lastUsedIso: lastUsedByAgent.get(agentId) ?? meta?.last_heartbeat,
        statusBreakdown: breakdown,
      };
    });

    agents.sort((a, b) => b.sessions - a.sessions);

    return {
      agents,
      rangeLabel: data.time_range.preset ?? preset,
      inferenceMetricsAvailable: false,
    };
  }, [data, preset]);

  return {
    summary,
    loading: loading && !summary,
    error,
    refresh,
    isRefreshing,
  };
}
