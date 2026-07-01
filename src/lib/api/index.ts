/**
 * Typed client for the unified Hanzo Cloud `/v1` backend.
 *
 * Endpoint surface (ported from hanzoai/ai web/src/backend/*.js), grouped by
 * resource. Every call goes through `client.ts` (cookie credentials, envelope
 * unwrapping, typed errors). Base URL is `config.cloudUrl` (default
 * https://cloud.hanzo.ai).
 */
export { ApiError, type ApiResponse } from './client'
export * from './types'

export { AccountApi } from './account'
export { ProjectApi, projectEnvironments, type Project } from './projects'
export { BotApi, type BotHealth } from './bot'
export {
  PlansApi,
  type CloudPlan,
  type CloudPricing,
  type BlockStoragePricing,
} from './plans'
export {
  WalletApi,
  type CloudBalance,
  type WalletTopupRequest,
  type WalletTopupResult,
} from './wallet'
export { ProviderApi } from './providers'
export { ModelRouteApi } from './model-routes'
export {
  CloudModelApi,
  providerLabels,
  type CloudModel,
  type CatalogModel,
  type ModelPricing,
} from './models-catalog'
export { ApplicationApi } from './applications'
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
  type PlatformApp,
  type AppHealth,
  type AppDriftFlag,
  type AppsQuery,
} from './platform'
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
export { TeamApi } from './team'
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
} from './playground'
export { AiApi, type AiChatInput } from './ai'
export { KeysApi, type KeyStatus } from './keys'
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
  type TrainExperiment,
  type MetricPoint,
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
