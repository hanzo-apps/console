import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../adapters";
import { PageHeader, TIME_FILTER_OPTIONS } from "../components/PageHeader";
import {
  getEnhancedExecutions,
  streamExecutionEvents,
} from "../services/executionsApi";
import type {
  EnhancedExecution,
  ExecutionViewFilters,
} from "../types/workflows";
import { getNextTimeRange } from "../lib/timeRanges";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { GuidedEmptyState } from "../components/ui/GuidedEmptyState";

type LogLevel = "all" | "info" | "warn" | "error";

const LOG_LEVEL_OPTIONS = [
  { value: "all", label: "All Levels" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warning" },
  { value: "error", label: "Error" },
];

const PAGE_SIZE = 50;

function statusToLevel(status: string): LogLevel {
  const lower = status.toLowerCase();
  if (lower === "failed" || lower === "error" || lower === "cancelled")
    return "error";
  if (lower === "running" || lower === "pending" || lower === "queued")
    return "warn";
  return "info";
}

function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 font-mono text-[10px] uppercase",
        level === "error" && "border-red-500/30 bg-red-500/5 text-red-500",
        level === "warn" && "border-amber-500/30 bg-amber-500/5 text-amber-500",
        level === "info" &&
          "border-muted-foreground/30 text-muted-foreground bg-muted-foreground/5",
      )}
    >
      {level}
    </Badge>
  );
}

/**
 * Unified log viewer page.
 * Shows execution logs and agent events in a simple list layout.
 * Filters: level, bot name, time range.
 */
export function LogsPage() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState("24h");
  const [level, setLevel] = useState<LogLevel>("all");
  const [botFilter, setBotFilter] = useState("");

  const [executions, setExecutions] = useState<EnhancedExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchLogs = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let escalatedTimeRange = false;

    try {
      setLoading(true);
      setError(null);

      const filters: ExecutionViewFilters = {};
      if (timeRange !== "all") {
        filters.timeRange = timeRange;
      }
      const response = await getEnhancedExecutions(
        filters,
        "started_at",
        "desc",
        1,
        PAGE_SIZE,
        controller.signal,
      );

      const results = response.executions ?? [];

      if (results.length === 0) {
        const broaderRange = getNextTimeRange(timeRange);
        if (broaderRange && broaderRange !== timeRange) {
          escalatedTimeRange = true;
          setTimeRange(broaderRange);
          return;
        }
      }

      setExecutions(results);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (!escalatedTimeRange) {
        setLoading(false);
      }
    }
  }, [timeRange]);

  useEffect(() => {
    fetchLogs();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchLogs]);

  // SSE for live updates
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = streamExecutionEvents();
      eventSource.onmessage = (event) => {
        if (!event.data?.trim()?.startsWith("{")) return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.execution) {
            fetchLogs();
          }
        } catch {
          // ignore parse errors
        }
      };
      eventSource.onerror = () => {
        // SSE reconnects automatically
      };
    } catch {
      // SSE not available
    }
    return () => {
      eventSource?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter executions by level and bot name
  const filteredLogs = useMemo(() => {
    return executions.filter((exec) => {
      if (level !== "all" && statusToLevel(exec.status) !== level) return false;
      if (
        botFilter &&
        !exec.agent_name?.toLowerCase().includes(botFilter.toLowerCase())
      )
        return false;
      return true;
    });
  }, [executions, level, botFilter]);

  const handleRowClick = (exec: EnhancedExecution) => {
    if (exec.workflow_id) {
      navigate(`/workflows/${exec.workflow_id}`);
    } else {
      navigate(`/executions/${exec.execution_id}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs"
        description="Unified view of execution logs and agent events"
        filters={[
          {
            label: "Time Range",
            value: timeRange,
            options: TIME_FILTER_OPTIONS,
            onChange: (value) => setTimeRange(value),
          },
          {
            label: "Level",
            value: level,
            options: LOG_LEVEL_OPTIONS,
            onChange: (value) => setLevel(value as LogLevel),
          },
        ]}
      />

      {/* Bot name search */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter by bot name..."
          value={botFilter}
          onChange={(e) => setBotFilter(e.target.value)}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-8 w-64 rounded-md border px-3 text-sm focus-visible:ring-1 focus-visible:outline-none"
        />
        {botFilter && (
          <button
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={() => setBotFilter("")}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/10">
          <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
          <button
            onClick={fetchLogs}
            className="mt-2 text-xs text-red-600 hover:underline dark:text-red-400"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted/30 h-12 animate-pulse rounded-md"
            />
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <GuidedEmptyState
          icon="activity"
          title="No logs yet"
          description="Connect a bot to start streaming logs and execution events"
          primaryAction={{ label: "Connect Bot", href: "/settings" }}
          tip="Run `hanzo bot run` locally to connect"
        />
      ) : (
        <div className="border-border overflow-hidden rounded-lg border">
          <div className="divide-border divide-y">
            {filteredLogs.map((exec) => {
              const logLevel = statusToLevel(exec.status);
              return (
                <button
                  key={exec.execution_id}
                  onClick={() => handleRowClick(exec)}
                  className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors"
                >
                  <span className="text-muted-foreground w-24 shrink-0 font-mono text-xs">
                    {exec.relative_time}
                  </span>
                  <LevelBadge level={logLevel} />
                  <span className="min-w-0 truncate font-medium">
                    {exec.task_name || exec.workflow_name || "Execution"}
                  </span>
                  {exec.agent_name && (
                    <span className="text-muted-foreground truncate font-mono text-xs">
                      {exec.agent_name}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {exec.duration_display}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {exec.status}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
