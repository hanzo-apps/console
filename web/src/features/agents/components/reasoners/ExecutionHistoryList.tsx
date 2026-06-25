import {
  CheckmarkFilled,
  ErrorFilled,
  Time,
  Copy,
  WarningFilled,
  Launch,
  InProgress,
} from "@/src/features/agents/components/ui/icon-bridge";
import type { ReactNode } from "react";
import { useNavigate } from "../../adapters";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import type { ExecutionHistory } from "../../types/execution";
import type { CanonicalStatus } from "../../utils/status";
import { getStatusLabel, normalizeExecutionStatus } from "../../utils/status";

interface ExecutionHistoryListProps {
  history?: ExecutionHistory | null;
  onLoadMore?: () => void;
}

export function ExecutionHistoryList({
  history,
  onLoadMore,
}: ExecutionHistoryListProps) {
  const navigate = useNavigate();

  const handleCopyExecution = (executionId: string) => {
    navigator.clipboard.writeText(executionId);
  };

  const handleNavigateToExecution = (executionId: string) => {
    navigate(`/executions/${executionId}`);
  };

  const handleRowClick = (executionId: string, event: React.MouseEvent) => {
    // Prevent navigation if clicking on action buttons
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    handleNavigateToExecution(executionId);
  };

  const handleCopyClick = (event: React.MouseEvent, executionId: string) => {
    event.stopPropagation();
    handleCopyExecution(executionId);
  };

  const handleViewDetailsClick = (
    event: React.MouseEvent,
    executionId: string,
  ) => {
    event.stopPropagation();
    handleNavigateToExecution(executionId);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

  const STATUS_META: Record<
    CanonicalStatus,
    { icon: ReactNode; variant: BadgeVariant }
  > = {
    succeeded: {
      icon: <CheckmarkFilled className="h-4 w-4 text-green-500" />,
      variant: "default",
    },
    failed: {
      icon: <ErrorFilled className="h-4 w-4 text-red-500" />,
      variant: "destructive",
    },
    running: {
      icon: (
        <InProgress className="text-muted-foreground h-4 w-4 animate-spin" />
      ),
      variant: "secondary",
    },
    queued: {
      icon: <Time className="h-4 w-4 text-yellow-500" />,
      variant: "secondary",
    },
    pending: {
      icon: <Time className="h-4 w-4 text-yellow-500" />,
      variant: "secondary",
    },
    cancelled: {
      icon: <WarningFilled className="text-muted-foreground h-4 w-4" />,
      variant: "outline",
    },
    timeout: {
      icon: <WarningFilled className="h-4 w-4 text-orange-500" />,
      variant: "outline",
    },
    unknown: {
      icon: <WarningFilled className="text-muted-foreground h-4 w-4" />,
      variant: "outline",
    },
  };

  const getStatusMeta = (status: string | null | undefined) => {
    const normalized = normalizeExecutionStatus(status);
    const meta = STATUS_META[normalized] ?? STATUS_META.unknown;
    return {
      ...meta,
      label: getStatusLabel(normalized),
      normalized,
    };
  };

  if (!history) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        <p>Loading execution history...</p>
      </div>
    );
  }

  // Safely handle null or undefined executions array
  const executions = history.executions || [];

  if (executions.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        <p>No executions found for this reasoner.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <p className="text-body-small">
          Showing {executions.length} of {history.total} executions
        </p>
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Execution ID</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {executions.map((execution) => {
              const statusMeta = getStatusMeta(execution.status);

              return (
                <TableRow
                  key={execution.execution_id}
                  className="hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={(e) => handleRowClick(execution.execution_id, e)}
                  role="button"
                  tabIndex={0}
                  aria-label={`View execution ${execution.execution_id}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleNavigateToExecution(execution.execution_id);
                    }
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {statusMeta.icon}
                      <Badge variant={statusMeta.variant}>
                        {statusMeta.label}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">
                      {execution.execution_id.slice(0, 8)}...
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Time className="text-muted-foreground h-3 w-3" />
                      <span className="text-sm">
                        {formatDuration(execution.duration_ms)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {formatTimestamp(execution.timestamp)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {execution.cost ? (
                      <span className="text-sm">
                        ${execution.cost.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-body-small">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) =>
                          handleViewDetailsClick(e, execution.execution_id)
                        }
                        className="h-8 w-8 p-0"
                        aria-label="View execution details"
                      >
                        <Launch className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) =>
                          handleCopyClick(e, execution.execution_id)
                        }
                        className="h-8 w-8 p-0"
                        aria-label="Copy execution ID"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="space-y-3 md:hidden">
        {executions.map((execution) => {
          const statusMeta = getStatusMeta(execution.status);

          return (
            <div
              key={execution.execution_id}
              className="hover:bg-accent/50 cursor-pointer space-y-3 rounded-lg border p-4 transition-colors"
              onClick={(e) => handleRowClick(execution.execution_id, e)}
              role="button"
              tabIndex={0}
              aria-label={`View execution ${execution.execution_id}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNavigateToExecution(execution.execution_id);
                }
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {statusMeta.icon}
                  <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) =>
                      handleViewDetailsClick(e, execution.execution_id)
                    }
                    className="h-8 w-8 p-0"
                    aria-label="View execution details"
                  >
                    <Launch className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleCopyClick(e, execution.execution_id)}
                    className="h-8 w-8 p-0"
                    aria-label="Copy execution ID"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-mono">
                    {execution.execution_id.slice(0, 12)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>{formatDuration(execution.duration_ms)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time:</span>
                  <span>{formatTimestamp(execution.timestamp)}</span>
                </div>
                {execution.cost && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cost:</span>
                    <span>${execution.cost.toFixed(4)}</span>
                  </div>
                )}
              </div>

              {execution.error_message && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm">
                  <p className="font-medium text-red-800">Error:</p>
                  <p className="mt-1 font-mono text-xs text-red-700">
                    {execution.error_message}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load More Button */}
      {executions.length < history.total && onLoadMore && (
        <div className="pt-4 text-center">
          <Button variant="outline" onClick={onLoadMore}>
            Load More Executions
          </Button>
        </div>
      )}

      {/* Pagination Info */}
      <div className="text-body-small text-center">
        Page {history.page} • {executions.length} of {history.total} executions
      </div>
    </div>
  );
}
