/**
 * Typed client for the unified Hanzo Cloud `/v1` backend.
 *
 * Endpoint surface (ported from hanzoai/ai web/src/backend/*.js), grouped by
 * resource. Every call goes through `client.ts` (cookie credentials, envelope
 * unwrapping, typed errors). Base URL is `config.cloudUrl` — same-origin in the
 * browser, and the ONE Hanzo API endpoint (https://api.hanzo.ai) off-origin.
 */
export { ApiError, type ApiResponse } from './client'
export * from './types'

export { AccountApi } from './account'
export { ProjectApi, projectEnvironments, type Project } from './projects'
export { BotApi, type BotHealth } from './bot'
export { PlansApi, type Plan, type PlanLimits } from './plans'
export { WalletApi, type CloudBalance } from './wallet'
export { ProviderApi } from './providers'
export { ModelRouteApi } from './model-routes'
export {
  CloudModelApi,
  providerLabels,
  type CloudModel,
  type CatalogModel,
  type ModelPricing,
} from './models-catalog'
export { StoreApi } from './stores'
export {
  EmbeddingsApi,
  type EmbeddingHit,
  type SearchMode,
  type SearchInput,
  type IndexStats,
  type FileRow,
  type EmbeddingResult,
  type IngestSource,
  type IngestStats,
} from './embeddings'
export { ChatApi } from './chats'
export { MessageApi } from './messages'
export {
  ProvisioningApi,
  type ResourceKind,
  type Resource,
  type ResourceCreated,
} from './provisioning'
export {
  PlatformApi,
  clustersFromApps,
  DOKS_REGIONS,
  DOKS_NODE_SIZES,
  type Cluster,
  type NodePool,
  type ClusterKind,
  type ProvisionClusterInput,
  type AttachClusterInput,
  type AddPoolInput,
  type PlatformApp,
  type AppHealth,
  type AppDriftFlag,
  type AppsQuery,
} from './platform'
export {
  PaasApi,
  type PaasProject,
  type PaasApp,
  type PaasAppWithProject,
  type PaasDeployment,
  type PaasEnvVar,
  type CreateProjectInput,
  type CreateAppInput,
  type DeployInput,
} from './paas'
export {
  IamAdminApi,
  KmsAdminApi,
  type Paged,
  type Organization,
  type ThemeData,
  type IamUser,
  type IamApplication,
  type IamProvider,
  type Role,
  type AuditRecord,
  type KmsSecretMeta,
  type KmsSecretValue,
  type KmsScope,
  type KmsRef,
} from './admin'
export {
  NodesApi,
  NODE_NETWORK_META,
  normalizeValidators,
  normalizePeers,
  combineInventory,
  parseUptimePct,
  parseHeight,
  fmtUptime,
  fmtHeight,
  fmtWeight,
  type NodeRow,
  type NodeRole,
  type NodeStatus,
  type NodeNetworkId,
  type NetworkInventory,
  type RawValidator,
  type RawPeer,
} from './nodes'
export { TeamApi, MembershipApi, orgNamesFor, type Membership } from './team'
export {
  PlaygroundApi,
  type ChatMessage,
  type ChatUsage,
  type ChatCompletion,
  type ChatRequest,
  type StreamMessage,
  type ChatStreamRequest,
  type EmbeddingsRequest,
  type EmbeddingsResponse,
  type SpeechRequest,
  type ImageRequest,
  type ImageResponse,
  type VideoRequest,
  type VideoResponse,
} from './playground'
export { AiApi, type AiChatInput } from './ai'
export { KeysApi, partitionKeys, type KeyStatus, type PublishableKey } from './keys'
export {
  PromptsApi,
  normalizePrompt,
  normalizePrompts,
  normalizeMetricRows,
  type Prompt,
  type NewPromptBody,
  type PromptMetricRow,
} from './prompts'
export {
  EvalsApi,
  type EvalScore,
  type EvalScoresPage,
  type EvalDataset,
  type EvalDatasetItem,
  type EvalDatasetRun,
  type EvalItemResult,
  type EvalRunSummary,
  type EvalRunRequest,
  type CreateDatasetBody,
  type CreateDatasetItemBody,
} from './evals'
export {
  MemoryApi,
  MEMORY_KINDS,
  type Memory,
  type MemoryKind,
  type MemoryFact,
  type RememberInput,
  type UpdateInput,
} from './memory'
export {
  TasksApi,
  type ClusterHealth,
  type ClusterStatus,
  type Namespace,
  type NamespaceInfo,
  type WorkflowExecution,
  type WorkflowDetail,
  type HistoryEvent,
  type Schedule,
  type TaskQueue,
  type Worker,
  type ActivityInfo,
} from './tasks'
export {
  TrainApi,
  TRAIN_TYPES,
  TRAIN_PRESETS,
  TRAIN_GPUS,
  type TrainJob,
  type TrainStatus,
  type MlModel,
  type CreateTrainJobInput,
} from './train'
export {
  O11yApi,
  type O11yList,
  type O11yPageMeta,
  type O11yListQuery,
  type Trace,
  type Observation,
  type O11yUser,
  type Score,
  type Session,
  type ScoreConfig,
  type ScoreConfigCategory,
  type AnnotationQueue,
  type AnnotationQueueDetail,
  type AnnotationQueueItem,
  type TraceDetail,
  type SessionDetail,
} from './o11y'
export { TelemetryApi, type Availability, type ServiceHealth, type Sample } from './telemetry'
export {
  ApmApi,
  apmWindow,
  normalizeService,
  normalizeServices,
  normalizeEdge,
  normalizeDependencies,
  normalizeTopOperations,
  normalizeHosts,
  normalizePods,
  normalizeNodes,
  normalizeException,
  normalizeExceptions,
  ErrorTrackingApi,
  normalizeIssue,
  normalizeIssues,
  normalizeIssueDetail,
  normalizeDashboard,
  normalizeDashboards,
  rawQueryPayload,
  parseRawRows,
  toIso,
  normalizeLogRow,
  normalizeLogs,
  normalizeTraceSpan,
  normalizeSpans,
  type ApmWindow,
  type ServiceRow,
  type DependencyEdge,
  type TopOperation,
  type HostRow,
  type PodRow,
  type NodeRow as ApmNodeRow, // distinct from nodes.ts NodeRow (blockchain nodes)
  type InfraList,
  type ExceptionGroup,
  type Issue,
  type IssueStatus,
  type IssueDetail,
  type Occurrence,
  type OccurrenceFrame,
  type IssuesQuery,
  type Dashboard,
  type O11yDataSource,
  type LogRow,
  type TraceSpan,
} from './apm'
// Integrations connector framework. The value + its types are exported under
// `Integration*`-prefixed names so the connector `Provider` never collides with the
// AI-model `Provider` (from ./types). The pure normalizers stay importable directly
// from './connectors' (the unit test uses that path).
export { ConnectorsApi, GitHubApi } from './connectors'
export type {
  Provider as ConnectorProvider,
  Connection as IntegrationConnection,
  ConnectResult as IntegrationConnectResult,
  GitHubRepo,
  GitHubImportResult,
} from './connectors'
