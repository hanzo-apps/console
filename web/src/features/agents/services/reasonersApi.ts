import type {
  ReasonersResponse,
  ReasonerWithNode,
  ReasonerFilters,
} from "../types/reasoners";
import type {
  ExecutionRequest,
  ExecutionResponse,
  ExecutionHistory,
  PerformanceMetrics,
  ExecutionTemplate,
  AsyncExecuteResponse,
  ExecutionStatusResponse,
} from "../types/execution";
import { getGlobalApiKey } from "./api";

const API_BASE_URL = "/api/agents/ui/v1";
const withAuthHeaders = (headers?: HeadersInit) => {
  const merged = new Headers(headers || {});
  const apiKey = getGlobalApiKey();
  if (apiKey) {
    merged.set("X-API-Key", apiKey);
  }
  return merged;
};

export class ReasonersApiError extends Error {
  public status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ReasonersApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Node → reasoner adapter
//
// The backend renamed "reasoner" → "bot" and removed the global /reasoners
// endpoints. Reasoners now live INSIDE nodes as `bots`. We aggregate the bots
// across all /nodes and present them in the legacy reasoner shape so the
// existing reasoners UI keeps working without a backend reasoners API.
// reasoner_id is "<node_id>.<bot_id>" (matches the legacy contract).
// ---------------------------------------------------------------------------
interface NodeBot {
  id: string;
  input_schema?: any;
  output_schema?: any;
  memory_config?: {
    auto_inject?: string[] | null;
    memory_retention?: string;
    cache_results?: boolean;
  } | null;
  tags?: string[] | null;
}

interface NodeListItem {
  id: string;
  version?: string;
  health_status?: string;
  lifecycle_status?: string;
  last_heartbeat?: string;
  registered_at?: string;
  bots?: NodeBot[] | null;
}

interface NodesListResponse {
  nodes?: NodeListItem[];
  count?: number;
}

const mapNodeStatus = (
  node: NodeListItem,
): "active" | "inactive" | "unknown" => {
  const lc = (node.lifecycle_status || "").toLowerCase();
  const hs = (node.health_status || "").toLowerCase();
  if (lc === "ready" || lc === "degraded" || hs === "active") return "active";
  if (lc === "offline" || lc === "stopped" || hs === "inactive")
    return "inactive";
  return "unknown";
};

const nodeBotToReasoner = (
  node: NodeListItem,
  bot: NodeBot,
): ReasonerWithNode => ({
  reasoner_id: `${node.id}.${bot.id}`,
  name: bot.id,
  description: "",
  node_id: node.id,
  node_status: mapNodeStatus(node),
  node_version: node.version || "",
  input_schema: bot.input_schema ?? null,
  output_schema: bot.output_schema ?? null,
  memory_config: {
    auto_inject: bot.memory_config?.auto_inject ?? [],
    memory_retention: bot.memory_config?.memory_retention ?? "",
    cache_results: bot.memory_config?.cache_results ?? false,
  },
  tags: bot.tags ?? undefined,
  last_updated: node.last_heartbeat || node.registered_at || "",
});

const fetchAllNodeReasoners = async (): Promise<{
  reasoners: ReasonerWithNode[];
  nodesCount: number;
}> => {
  const response = await fetch(`${API_BASE_URL}/nodes`, {
    headers: withAuthHeaders(),
  });
  if (!response.ok) {
    throw new ReasonersApiError(
      `Failed to fetch reasoners: ${response.statusText}`,
      response.status,
    );
  }
  const data: NodesListResponse = await response.json();
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const reasoners = nodes.flatMap((node) =>
    (Array.isArray(node.bots) ? node.bots : []).map((bot) =>
      nodeBotToReasoner(node, bot),
    ),
  );
  return { reasoners, nodesCount: nodes.length };
};

export const reasonersApi = {
  /**
   * Fetch all reasoners with optional filters.
   * Sourced from /nodes (bots), since the backend has no /reasoners endpoint.
   */
  getAllReasoners: async (
    filters: ReasonerFilters = {},
  ): Promise<ReasonersResponse> => {
    try {
      const { reasoners, nodesCount } = await fetchAllNodeReasoners();

      const online_count = reasoners.filter(
        (r) => r.node_status === "active",
      ).length;
      const offline_count = reasoners.length - online_count;

      let filtered = reasoners;
      if (filters.status === "online") {
        filtered = filtered.filter((r) => r.node_status === "active");
      } else if (filters.status === "offline") {
        filtered = filtered.filter((r) => r.node_status !== "active");
      }

      if (filters.search) {
        const q = filters.search.toLowerCase();
        filtered = filtered.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.node_id.toLowerCase().includes(q) ||
            r.reasoner_id.toLowerCase().includes(q),
        );
      }

      const offset = filters.offset ?? 0;
      const limited = filters.limit
        ? filtered.slice(offset, offset + filters.limit)
        : filtered.slice(offset);

      return {
        reasoners: limited,
        total: filtered.length,
        online_count,
        offline_count,
        nodes_count: nodesCount,
      };
    } catch (error) {
      if (error instanceof ReasonersApiError) {
        throw error;
      }
      throw new ReasonersApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },

  /**
   * Fetch details for a specific reasoner ("<node_id>.<bot_id>").
   * Sourced from /nodes (bots).
   */
  getReasonerDetails: async (reasonerId: string): Promise<ReasonerWithNode> => {
    try {
      const { reasoners } = await fetchAllNodeReasoners();
      const match = reasoners.find((r) => r.reasoner_id === reasonerId);
      if (!match) {
        throw new ReasonersApiError("Reasoner not found", 404);
      }
      return match;
    } catch (error) {
      if (error instanceof ReasonersApiError) {
        throw error;
      }
      throw new ReasonersApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },

  /**
   * Execute a reasoner with given input data (synchronous - waits for completion)
   * Enhanced version with proper request/response types and validation
   */
  executeReasoner: async (
    reasonerId: string,
    request: ExecutionRequest,
  ): Promise<ExecutionResponse> => {
    // Must go through the console agents proxy; a raw /api/v1 base hits the
    // console app (no such route) and 404s. /api/agents/v1 → backend /api/v1.
    const url = `/api/agents/v1/execute/${encodeURIComponent(reasonerId)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: withAuthHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ReasonersApiError(
          `Failed to execute reasoner: ${response.statusText} - ${errorText}`,
          response.status,
        );
      }

      const data: ExecutionResponse = await response.json();

      // Validate response structure
      if (!data || typeof data !== "object") {
        console.error("Invalid response structure:", data);
        throw new ReasonersApiError("Invalid response format from server");
      }

      // Log response for debugging if it seems malformed
      if (!data.result && !data.error_message && data.status !== "succeeded") {
        console.warn(
          "Response missing both result and error_message fields:",
          data,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof ReasonersApiError) {
        throw error;
      }

      // Enhanced error logging for debugging
      console.error("Reasoner execution error:", {
        reasonerId,
        request,
        error: error instanceof Error ? error.message : error,
      });

      throw new ReasonersApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },

  /**
   * Execute a reasoner asynchronously (returns immediately with execution_id)
   * Use this when you need the execution_id immediately for navigation/tracking
   */
  executeReasonerAsync: async (
    reasonerId: string,
    request: ExecutionRequest,
  ): Promise<AsyncExecuteResponse> => {
    const url = `/api/agents/v1/execute/async/${encodeURIComponent(reasonerId)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: withAuthHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ReasonersApiError(
          `Failed to execute reasoner async: ${response.statusText} - ${errorText}`,
          response.status,
        );
      }

      const data: AsyncExecuteResponse = await response.json();

      // Validate response structure
      if (!data || typeof data !== "object" || !data.execution_id) {
        console.error("Invalid async response structure:", data);
        throw new ReasonersApiError(
          "Invalid async response format from server",
        );
      }

      return data;
    } catch (error) {
      if (error instanceof ReasonersApiError) {
        throw error;
      }

      // Enhanced error logging for debugging
      console.error("Reasoner async execution error:", {
        reasonerId,
        request,
        error: error instanceof Error ? error.message : error,
      });

      throw new ReasonersApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },

  /**
   * Get execution status by execution_id
   * Use this to poll for execution completion after starting with executeReasonerAsync
   */
  getExecutionStatus: async (
    executionId: string,
  ): Promise<ExecutionStatusResponse> => {
    const url = `/api/agents/v1/executions/${encodeURIComponent(executionId)}`;

    try {
      const response = await fetch(url, { headers: withAuthHeaders() });

      if (!response.ok) {
        if (response.status === 404) {
          throw new ReasonersApiError("Execution not found", 404);
        }
        throw new ReasonersApiError(
          `Failed to fetch execution status: ${response.statusText}`,
          response.status,
        );
      }

      const data: ExecutionStatusResponse = await response.json();

      // Validate response structure
      if (!data || typeof data !== "object" || !data.execution_id) {
        console.error("Invalid execution status response structure:", data);
        throw new ReasonersApiError(
          "Invalid execution status response format from server",
        );
      }

      return data;
    } catch (error) {
      if (error instanceof ReasonersApiError) {
        throw error;
      }

      console.error("Execution status fetch error:", {
        executionId,
        error: error instanceof Error ? error.message : error,
      });

      throw new ReasonersApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },

  /**
   * Performance metrics. The backend has no per-reasoner metrics endpoint
   * after the reasoner→bot refactor; return empty defaults so the reasoner
   * detail page renders without 404s.
   */
  getPerformanceMetrics: async (
    _reasonerId: string,
  ): Promise<PerformanceMetrics> => {
    return {
      avg_response_time_ms: 0,
      success_rate: 0,
      total_executions: 0,
      executions_last_24h: 0,
      error_rate: 0,
      recent_executions: [],
      performance_trend: [],
    };
  },

  /**
   * Execution history. No backend equivalent after the reasoner→bot refactor;
   * return an empty page so the detail page renders without 404s.
   */
  getExecutionHistory: async (
    _reasonerId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<ExecutionHistory> => {
    return {
      executions: [],
      total: 0,
      page,
      limit,
    };
  },

  /**
   * Saved execution templates. No backend equivalent; return an empty list.
   */
  getExecutionTemplates: async (
    _reasonerId: string,
  ): Promise<ExecutionTemplate[]> => {
    return [];
  },

  /**
   * Save an execution template
   */
  saveExecutionTemplate: async (
    reasonerId: string,
    template: Omit<ExecutionTemplate, "id" | "created_at">,
  ): Promise<ExecutionTemplate> => {
    // Backend renamed /reasoners → /bots and keys templates on the bot id.
    // reasonerId is "<node_id>.<bot_id>"; send the bot segment.
    const botId = reasonerId.includes(".")
      ? reasonerId.slice(reasonerId.lastIndexOf(".") + 1)
      : reasonerId;
    const url = `${API_BASE_URL}/bots/${encodeURIComponent(botId)}/templates`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: withAuthHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(template),
      });

      if (!response.ok) {
        throw new ReasonersApiError(
          `Failed to save execution template: ${response.statusText}`,
          response.status,
        );
      }

      const data: ExecutionTemplate = await response.json();
      return data;
    } catch (error) {
      if (error instanceof ReasonersApiError) {
        throw error;
      }
      throw new ReasonersApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },

  /**
   * Create an SSE connection for real-time events.
   * The backend has no /reasoners/events; reuse the node event stream so the
   * connection succeeds (node lifecycle changes drive the reasoner list).
   */
  createEventStream: (
    onEvent: (event: any) => void,
    onError?: (error: Error) => void,
    onConnect?: () => void,
  ): EventSource => {
    const apiKey = getGlobalApiKey();
    const url = apiKey
      ? `${API_BASE_URL}/nodes/events?api_key=${encodeURIComponent(apiKey)}`
      : `${API_BASE_URL}/nodes/events`;
    console.log("🔄 Attempting to create SSE connection to:", url);
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      console.log("✅ Reasoner SSE connection opened successfully");
      onConnect?.();
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📡 Received reasoner event:", data);
        onEvent(data);
      } catch (error) {
        console.error(
          "❌ Failed to parse SSE event data:",
          error,
          "Raw data:",
          event.data,
        );
        onError?.(new Error("Failed to parse event data"));
      }
    };

    eventSource.onerror = (error) => {
      console.error("❌ Reasoner SSE connection error:", error);
      console.error("❌ EventSource readyState:", eventSource.readyState);
      console.error("❌ EventSource url:", eventSource.url);
      onError?.(
        new Error(
          `SSE connection error - readyState: ${eventSource.readyState}`,
        ),
      );
    };

    return eventSource;
  },

  /**
   * Close an SSE connection
   */
  closeEventStream: (eventSource: EventSource): void => {
    if (eventSource) {
      eventSource.close();
      console.log("🔌 Reasoner SSE connection closed");
    }
  },
};
