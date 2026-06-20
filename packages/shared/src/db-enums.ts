/**
 * Canonical enum definitions for the application database.
 *
 * SQLite (Hanzo Base) has no native enum type, so the Prisma schema models
 * these columns as `String`. To keep every existing consumer working without
 * touching call sites, each former Prisma enum is re-expressed here as a frozen
 * const object plus a matching union type with the SAME exported name. This
 * preserves both value usage (`Role.OWNER`) and type usage (`type Role`)
 * exactly as Prisma's generated client did.
 *
 * These objects are re-exported from `db.ts` (and therefore from
 * `@hanzo/console` and `@hanzo/console/src/db`), which previously surfaced the
 * generated Prisma enums. The runtime values match the strings persisted in the
 * database, so they are safe to use directly in Prisma `where`/`data` clauses.
 *
 * The allowed values are also the single source of truth for validation; use
 * `z.nativeEnum(<Enum>)` against any of these objects to enforce membership in
 * application code.
 */

export const ApiKeyScope = {
  ORGANIZATION: "ORGANIZATION",
  PROJECT: "PROJECT",
} as const;
export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const Role = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  ADMIN_BILLING: "ADMIN_BILLING",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
  NONE: "NONE",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** DB column `ObservationType` (legacy Postgres-era observations table). */
export const LegacyPrismaObservationType = {
  SPAN: "SPAN",
  EVENT: "EVENT",
  GENERATION: "GENERATION",
  AGENT: "AGENT",
  TOOL: "TOOL",
  CHAIN: "CHAIN",
  RETRIEVER: "RETRIEVER",
  EVALUATOR: "EVALUATOR",
  EMBEDDING: "EMBEDDING",
  GUARDRAIL: "GUARDRAIL",
} as const;
export type LegacyPrismaObservationType =
  (typeof LegacyPrismaObservationType)[keyof typeof LegacyPrismaObservationType];

/** DB column `ObservationLevel` (legacy Postgres-era observations table). */
export const LegacyPrismaObservationLevel = {
  DEBUG: "DEBUG",
  DEFAULT: "DEFAULT",
  WARNING: "WARNING",
  ERROR: "ERROR",
} as const;
export type LegacyPrismaObservationLevel =
  (typeof LegacyPrismaObservationLevel)[keyof typeof LegacyPrismaObservationLevel];

/** DB column `ScoreSource` (legacy Postgres-era scores table). */
export const LegacyPrismaScoreSource = {
  ANNOTATION: "ANNOTATION",
  API: "API",
  EVAL: "EVAL",
} as const;
export type LegacyPrismaScoreSource = (typeof LegacyPrismaScoreSource)[keyof typeof LegacyPrismaScoreSource];

export const ScoreConfigDataType = {
  CATEGORICAL: "CATEGORICAL",
  NUMERIC: "NUMERIC",
  BOOLEAN: "BOOLEAN",
  TEXT: "TEXT",
} as const;
export type ScoreConfigDataType = (typeof ScoreConfigDataType)[keyof typeof ScoreConfigDataType];

export const AnnotationQueueStatus = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
} as const;
export type AnnotationQueueStatus = (typeof AnnotationQueueStatus)[keyof typeof AnnotationQueueStatus];

export const AnnotationQueueObjectType = {
  TRACE: "TRACE",
  OBSERVATION: "OBSERVATION",
  SESSION: "SESSION",
} as const;
export type AnnotationQueueObjectType = (typeof AnnotationQueueObjectType)[keyof typeof AnnotationQueueObjectType];

export const DatasetStatus = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;
export type DatasetStatus = (typeof DatasetStatus)[keyof typeof DatasetStatus];

export const CommentObjectType = {
  TRACE: "TRACE",
  OBSERVATION: "OBSERVATION",
  SESSION: "SESSION",
  PROMPT: "PROMPT",
} as const;
export type CommentObjectType = (typeof CommentObjectType)[keyof typeof CommentObjectType];

export const NotificationChannel = {
  EMAIL: "EMAIL",
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationType = {
  COMMENT_MENTION: "COMMENT_MENTION",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const AuditLogRecordType = {
  USER: "USER",
  API_KEY: "API_KEY",
} as const;
export type AuditLogRecordType = (typeof AuditLogRecordType)[keyof typeof AuditLogRecordType];

export const EvalTemplateType = {
  LLM_AS_JUDGE: "LLM_AS_JUDGE",
  CODE: "CODE",
} as const;
export type EvalTemplateType = (typeof EvalTemplateType)[keyof typeof EvalTemplateType];

export const EvalTemplateSourceCodeLanguage = {
  PYTHON: "PYTHON",
  TYPESCRIPT: "TYPESCRIPT",
} as const;
export type EvalTemplateSourceCodeLanguage =
  (typeof EvalTemplateSourceCodeLanguage)[keyof typeof EvalTemplateSourceCodeLanguage];

export const JobType = {
  EVAL: "EVAL",
} as const;
export type JobType = (typeof JobType)[keyof typeof JobType];

export const JobConfigState = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;
export type JobConfigState = (typeof JobConfigState)[keyof typeof JobConfigState];

export const EvaluatorBlockReason = {
  LLM_CONNECTION_AUTH_INVALID: "LLM_CONNECTION_AUTH_INVALID",
  LLM_CONNECTION_MISSING: "LLM_CONNECTION_MISSING",
  DEFAULT_EVAL_MODEL_MISSING: "DEFAULT_EVAL_MODEL_MISSING",
  EVAL_MODEL_CONFIG_INVALID: "EVAL_MODEL_CONFIG_INVALID",
  EVAL_MODEL_UNAVAILABLE: "EVAL_MODEL_UNAVAILABLE",
  PROVIDER_ACCOUNT_NOT_READY: "PROVIDER_ACCOUNT_NOT_READY",
} as const;
export type EvaluatorBlockReason = (typeof EvaluatorBlockReason)[keyof typeof EvaluatorBlockReason];

export const JobExecutionStatus = {
  COMPLETED: "COMPLETED",
  ERROR: "ERROR",
  PENDING: "PENDING",
  CANCELLED: "CANCELLED",
  DELAYED: "DELAYED",
} as const;
export type JobExecutionStatus = (typeof JobExecutionStatus)[keyof typeof JobExecutionStatus];

export const BlobStorageIntegrationFileType = {
  JSON: "JSON",
  CSV: "CSV",
  JSONL: "JSONL",
} as const;
export type BlobStorageIntegrationFileType =
  (typeof BlobStorageIntegrationFileType)[keyof typeof BlobStorageIntegrationFileType];

export const BlobStorageIntegrationType = {
  S3: "S3",
  S3_COMPATIBLE: "S3_COMPATIBLE",
  AZURE_BLOB_STORAGE: "AZURE_BLOB_STORAGE",
} as const;
export type BlobStorageIntegrationType = (typeof BlobStorageIntegrationType)[keyof typeof BlobStorageIntegrationType];

export const BlobStorageExportMode = {
  FULL_HISTORY: "FULL_HISTORY",
  FROM_TODAY: "FROM_TODAY",
  FROM_CUSTOM_DATE: "FROM_CUSTOM_DATE",
} as const;
export type BlobStorageExportMode = (typeof BlobStorageExportMode)[keyof typeof BlobStorageExportMode];

export const AnalyticsIntegrationExportSource = {
  TRACES_OBSERVATIONS: "TRACES_OBSERVATIONS",
  TRACES_OBSERVATIONS_EVENTS: "TRACES_OBSERVATIONS_EVENTS",
  EVENTS: "EVENTS",
} as const;
export type AnalyticsIntegrationExportSource =
  (typeof AnalyticsIntegrationExportSource)[keyof typeof AnalyticsIntegrationExportSource];

export const DashboardWidgetViews = {
  TRACES: "TRACES",
  OBSERVATIONS: "OBSERVATIONS",
  SCORES_NUMERIC: "SCORES_NUMERIC",
  SCORES_CATEGORICAL: "SCORES_CATEGORICAL",
} as const;
export type DashboardWidgetViews = (typeof DashboardWidgetViews)[keyof typeof DashboardWidgetViews];

export const DashboardWidgetChartType = {
  LINE_TIME_SERIES: "LINE_TIME_SERIES",
  AREA_TIME_SERIES: "AREA_TIME_SERIES",
  BAR_TIME_SERIES: "BAR_TIME_SERIES",
  HORIZONTAL_BAR: "HORIZONTAL_BAR",
  VERTICAL_BAR: "VERTICAL_BAR",
  PIE: "PIE",
  NUMBER: "NUMBER",
  HISTOGRAM: "HISTOGRAM",
  PIVOT_TABLE: "PIVOT_TABLE",
} as const;
export type DashboardWidgetChartType = (typeof DashboardWidgetChartType)[keyof typeof DashboardWidgetChartType];

export const ActionType = {
  WEBHOOK: "WEBHOOK",
  SLACK: "SLACK",
  GITHUB_DISPATCH: "GITHUB_DISPATCH",
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export const ActionExecutionStatus = {
  COMPLETED: "COMPLETED",
  ERROR: "ERROR",
  PENDING: "PENDING",
  CANCELLED: "CANCELLED",
} as const;
export type ActionExecutionStatus = (typeof ActionExecutionStatus)[keyof typeof ActionExecutionStatus];

export const MonitorThresholdOperator = {
  GT: "GT",
  GTE: "GTE",
  LT: "LT",
  LTE: "LTE",
  EQ: "EQ",
  NEQ: "NEQ",
} as const;
export type MonitorThresholdOperator = (typeof MonitorThresholdOperator)[keyof typeof MonitorThresholdOperator];

export const MonitorView = {
  OBSERVATIONS: "OBSERVATIONS",
  SCORES_NUMERIC: "SCORES_NUMERIC",
  SCORES_CATEGORICAL: "SCORES_CATEGORICAL",
} as const;
export type MonitorView = (typeof MonitorView)[keyof typeof MonitorView];

export const MonitorSeverity = {
  UNKNOWN: "UNKNOWN",
  NO_DATA: "NO_DATA",
  OK: "OK",
  WARNING: "WARNING",
  ALERT: "ALERT",
} as const;
export type MonitorSeverity = (typeof MonitorSeverity)[keyof typeof MonitorSeverity];

export const MonitorStatus = {
  PAUSED: "PAUSED",
  ACTIVE: "ACTIVE",
  ERROR_BAD_QUERY: "ERROR_BAD_QUERY",
} as const;
export type MonitorStatus = (typeof MonitorStatus)[keyof typeof MonitorStatus];

/**
 * Values are persisted lowercase in the database (the former Prisma enum used
 * `@map("org_onboarding")` / `@map("user_onboarding")`). Consumers reference
 * `SurveyName.ORG_ONBOARDING`, which resolves to the stored string, so reads
 * and writes round-trip correctly against the `String` column.
 */
export const SurveyName = {
  ORG_ONBOARDING: "org_onboarding",
  USER_ONBOARDING: "user_onboarding",
} as const;
export type SurveyName = (typeof SurveyName)[keyof typeof SurveyName];
