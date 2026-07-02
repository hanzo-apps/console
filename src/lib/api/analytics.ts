/**
 * Typed client for the unified analytics data plane (cloud `clients/analytics`),
 * called SAME-ORIGIN with NO prefix (`originV1Url('analytics/...')`). The rewrite
 * in next.config.mjs terminates the request at the console's `/cloud` user-bearer
 * proxy, which mints a short-lived user Bearer and forwards to cloud-api; the org
 * is resolved server-authoritatively from the Bearer owner claim, so every metric
 * is scoped to the caller's own org — the browser never holds a datastore credential.
 *
 * Two lenses over ONE ClickHouse warehouse (datastore) — see
 * universe/docs/architecture/unified-analytics.md:
 *   - WEB / COMMERCE — hanzo.events + the events_daily/events_hourly rollups.
 *   - LLM — hanzo.cloud_usage (live) + hanzo.observations (traces).
 *
 * Every field is a real query result; zero/[] is honest-empty (never fabricated).
 */
import { restGet, originV1Url } from './client'

const BASE = 'analytics'

const q = (path: string, range?: Range, limit?: number): string => {
  const sp = new URLSearchParams()
  if (range) sp.set('range', range)
  if (limit != null) sp.set('limit', String(limit))
  const s = sp.toString()
  return originV1Url(`${BASE}/${path}${s ? `?${s}` : ''}`)
}

/** A compact time window understood by the backend (defaults to 30d server-side). */
export type Range = '1h' | '24h' | '7d' | '30d' | '90d'

/** Web/commerce headline (the Overview view). */
export type Overview = {
  pageviews: number
  visitors: number
  visits: number
  orders: number
  revenue: number
  aov: number
  conversion: number
  aiRequests: number
  totalTokens: number
  webEvents: number
  events: number
}

/** One day of the revenue/traffic timeseries. */
export type TimePoint = {
  date: string
  pageviews: number
  visitors: number
  orders: number
  revenue: number
}

/** One row of a top-N breakdown (pages / referrers / products). */
export type TopRow = {
  key: string
  count: number
  value: number
}

/** One live event in the real-time feed. */
export type RealtimeEvent = {
  event: string
  urlPath: string
  referrer: string
  country: string
  browser: string
  timestamp: string
}

/** Last-5-minutes web snapshot (the Real-Time view). */
export type Realtime = {
  active: number
  feed: RealtimeEvent[]
}

/** LLM headline (the insights lens Overview), from the live cloud_usage ledger. */
export type LLMOverview = {
  requests: number
  totalTokens: number
  cost: number
  errorRate: number
  models: number
}

/** Per-model LLM usage (token/cost-by-model). */
export type LLMModelRow = {
  model: string
  provider: string
  requests: number
  tokens: number
  cost: number
}

/** Health of the analytics surface — reports whether the warehouse is wired. */
export type AnalyticsHealth = {
  status: string
  service: string
  warehouse: boolean
}

/**
 * AnalyticsApi — one typed method per `/v1/analytics/*` endpoint. Each is a plain
 * GET through the same-origin `/cloud` bearer proxy; the org is server-side.
 */
export const AnalyticsApi = {
  health: (): Promise<AnalyticsHealth> => restGet<AnalyticsHealth>(originV1Url(`${BASE}/health`)),

  // Web / commerce lens.
  overview: (range?: Range): Promise<Overview> => restGet<Overview>(q('overview', range)),
  timeseries: (range?: Range): Promise<TimePoint[]> => restGet<TimePoint[]>(q('timeseries', range)),
  topReferrers: (range?: Range, limit?: number): Promise<TopRow[]> => restGet<TopRow[]>(q('top/referrers', range, limit)),
  topPages: (range?: Range, limit?: number): Promise<TopRow[]> => restGet<TopRow[]>(q('top/pages', range, limit)),
  topProducts: (range?: Range, limit?: number): Promise<TopRow[]> => restGet<TopRow[]>(q('top/products', range, limit)),
  realtime: (limit?: number): Promise<Realtime> => restGet<Realtime>(q('realtime', undefined, limit)),

  // LLM lens.
  llmOverview: (range?: Range): Promise<LLMOverview> => restGet<LLMOverview>(q('llm/overview', range)),
  llmModels: (range?: Range, limit?: number): Promise<LLMModelRow[]> => restGet<LLMModelRow[]>(q('llm/models', range, limit)),
}
