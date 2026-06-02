import { type ColumnDefinition, JobConfigState } from "@hanzo/console-core";

export const evalConfigFilterColumns: ColumnDefinition[] = [
  {
    name: "Status",
    id: "status",
    type: "stringOptions",
    internal: evaluatorDisplayStatusSql,
    options: [...Object.values(JobConfigState), "PAUSED"].map((value) => ({
      value,
    })),
  },
  {
    name: "Target",
    id: "target",
    type: "stringOptions",
    internal: 'jc."target_object"',
    options: evalConfigTargetOptions,
  },
];

export const evalConfigsTableCols: ColumnDefinition[] = [
  {
    ...evalConfigFilterColumns[0],
    internal: evaluatorStatusSortRankSql,
  },
  evalConfigFilterColumns[1],
  {
    name: "Updated At",
    id: "updatedAt",
    type: "datetime",
    internal: 'jc."updated_at"',
  },
  {
    name: "Created At",
    id: "createdAt",
    type: "datetime",
    internal: 'jc."created_at"',
  },
];
