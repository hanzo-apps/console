import {
  EvalTargetObject,
  type ColumnDefinition,
  JobConfigState,
} from "@hanzo/console";

export const evalConfigTargetOptions = Object.values(EvalTargetObject).map(
  (value) => ({
    value,
  }),
);

export const evalConfigTargetValues = evalConfigTargetOptions.map(
  (option) => option.value,
);

// SQLite: `status` is a TEXT column (no enums), so no `::text` cast is needed.
const evaluatorDisplayStatusSql = `CASE
  WHEN jc."status" = 'INACTIVE' THEN 'INACTIVE'
  WHEN jc."blocked_at" IS NOT NULL THEN 'PAUSED'
  ELSE jc."status"
END`;

const evaluatorStatusSortRankSql = `CASE
  WHEN jc."status" = 'INACTIVE' THEN 2
  WHEN jc."blocked_at" IS NOT NULL THEN 1
  ELSE 0
END`;

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
