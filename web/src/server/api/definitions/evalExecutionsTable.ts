import { type ColumnDefinition, JobExecutionStatus } from "@hanzo/console";

export const evalExecutionsFilterCols: ColumnDefinition[] = [
  {
    name: "Status",
    id: "status",
    type: "stringOptions",
    // SQLite: `status` is a TEXT column (no enums), so no `::text` cast is needed.
    internal: 'je."status"',
    options: Object.values(JobExecutionStatus)
      .filter((value) => value !== JobExecutionStatus.CANCELLED)
      .map((value) => ({ value })),
  },
  {
    name: "Trace ID",
    id: "traceId",
    type: "string",
    internal: 'je."job_input_trace_id"',
  },
  {
    name: "Execution Trace ID",
    id: "executionTraceId",
    type: "string",
    internal: 'je."execution_trace_id"',
  },
];
