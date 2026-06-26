import {
  Analytics,
  CheckmarkFilled,
  ErrorFilled,
  InProgress,
} from "@/src/features/agents/components/ui/icon-bridge";
import { Badge } from "./ui/badge";
import type { ExecutionStats } from "../types/executions";

interface ExecutionStatsCardProps {
  stats: ExecutionStats;
  className?: string;
}

export function ExecutionStatsCard({
  stats,
  className = "",
}: ExecutionStatsCardProps) {
  // Add null/undefined checks for all stats properties
  const totalExecutions = stats?.total_executions ?? 0;
  const successfulExecutions =
    stats?.successful_executions ?? stats?.successful_count ?? 0;
  const failedExecutions = stats?.failed_executions ?? stats?.failed_count ?? 0;
  const runningExecutions =
    stats?.running_executions ?? stats?.running_count ?? 0;

  const successRate =
    totalExecutions > 0
      ? ((successfulExecutions / totalExecutions) * 100).toFixed(1)
      : "0";

  const failureRate =
    totalExecutions > 0
      ? ((failedExecutions / totalExecutions) * 100).toFixed(1)
      : "0";

  return (
    <div className={`bg-card rounded-lg border p-4 ${className}`}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Total Executions */}
        <div className="flex items-center gap-3">
          <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-md">
            <Analytics className="text-muted-foreground h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-body-small">Total Executions</p>
            <p className="text-heading-3">{totalExecutions.toLocaleString()}</p>
          </div>
        </div>

        {/* Successful Executions */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-100 dark:bg-green-900/20">
            <CheckmarkFilled className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-body-small">Successful</p>
              <Badge
                variant="outline"
                className="h-4 border-green-200 bg-green-50 px-1.5 text-xs text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
              >
                {successRate}%
              </Badge>
            </div>
            <p className="text-heading-3 text-green-600 dark:text-green-400">
              {successfulExecutions.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Failed Executions */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-100 dark:bg-red-900/20">
            <ErrorFilled className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-body-small">Failed</p>
              <Badge
                variant="outline"
                className="h-4 border-red-200 bg-red-50 px-1.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
              >
                {failureRate}%
              </Badge>
            </div>
            <p className="text-heading-3 text-red-600 dark:text-red-400">
              {failedExecutions.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Running Executions */}
        <div className="flex items-center gap-3">
          <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-md">
            <InProgress className="text-muted-foreground h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-body-small">Currently Running</p>
            <p className="text-heading-3 text-muted-foreground">
              {runningExecutions.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
