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
  type ClusterKind,
  type ProvisionClusterInput,
  type PlatformApp,
  type AppHealth,
  type AppDriftFlag,
  type AppsQuery,
} from './platform'
export {
  IamAdminApi,
  type Paged,
  type Organization,
  type IamUser,
  type Role,
  type AuditRecord,
} from './admin'
export {
  PlaygroundApi,
  type ChatMessage,
  type ChatUsage,
  type ChatCompletion,
  type ChatRequest,
} from './playground'
export { AiApi, type AiChatInput } from './ai'
export {
  EvalsApi,
  type EvalScore,
  type EvalScoresPage,
  type EvalDataset,
  type EvalItemResult,
  type EvalRunSummary,
  type EvalRunRequest,
  type CreateDatasetBody,
  type CreateDatasetItemBody,
} from './evals'
export {
  O11yApi,
  type O11yList,
  type O11yPageMeta,
  type O11yListQuery,
  type Trace,
  type Observation,
  type Score,
  type Session,
  type ScoreConfig,
  type ScoreConfigCategory,
  type AnnotationQueue,
  type TraceDetail,
  type SessionDetail,
} from './o11y'
