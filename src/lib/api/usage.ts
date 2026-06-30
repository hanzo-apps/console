/**
 * Cloud usage client — the read side of the `hanzo.cloud_usage` ledger.
 *
 * Hits the unified `/v1/get-cloud-usages` endpoint (controllers/cloud_usage.go in
 * hanzoai/ai) through the same cookie-credentialed envelope transport as the rest
 * of the console. Org scope is server-side: `client.ts` stamps `X-Org-Id:
 * currentOrg()` on every call, so a tenant sees only its own org and a global
 * admin sees the org it switched to. For the all-orgs admin god-view (the same
 * endpoint, the same shape — reused by admin.hanzo.ai) pass `allOrgs: true`,
 * which forwards `?org=all`; the backend honors it only for a global admin and
 * ignores it for a tenant (who stays scoped — no cross-org leak).
 *
 * Money is USD cents end-to-end. A delta `pct` is `null` when the prior period
 * had no basis, so the UI shows an honest "—" rather than a fabricated ratio.
 */
import { get } from './client'

export type CloudUsageTotals = {
  tokens: number
  promptTokens: number
  completionTokens: number
  requests: number
  spendCents: number
  models: number
  providers: number
}

export type CloudUsageDelta = {
  current: number
  prior: number
  /** Percent change vs the prior period; null when prior == 0 (no basis). */
  pct: number | null
}

export type CloudUsageSeriesPoint = {
  /** RFC3339 bucket start (UTC). */
  t: string
  tokens: number
  spendCents: number
  requests: number
  models: number
}

export type CloudUsageModelSpend = {
  model: string
  provider: string
  spendCents: number
  tokens: number
  requests: number
  /** Share of total spend, 0..100. */
  pct: number
}

export type CloudUsageModelOther = {
  spendCents: number
  tokens: number
  requests: number
  pct: number
  modelCount: number
}

export type CloudUsageByModel = {
  items: CloudUsageModelSpend[]
  other: CloudUsageModelOther | null
  totalCents: number
}

export type CloudUsageActivityRow = {
  /** RFC3339 (UTC). */
  time: string
  model: string
  provider: string
  /** Event class — "inference" for every row in this ledger. */
  type: string
  status: string
  tokens: number
  promptTokens: number
  completionTokens: number
  costCents: number
  stream: boolean
  premium: boolean
  requestId: string
  org: string
  user: string
}

export type CloudUsageActivity = {
  items: CloudUsageActivityRow[]
  limit: number
  offset: number
  total: number
  type: string
}

export type CloudUsageScope = {
  /** Resolved org slug; "" when allOrgs. */
  org: string
  allOrgs: boolean
}

export type CloudUsageOverview = {
  range: string
  start: string
  end: string
  interval: string
  scope: CloudUsageScope
  totals: CloudUsageTotals
  /** Keyed by metric: tokens, spendCents, requests, models. */
  deltas: Record<string, CloudUsageDelta>
  series: CloudUsageSeriesPoint[]
  byModel: CloudUsageByModel
  activity: CloudUsageActivity
}

export type UsageRange = '24h' | '7d' | '30d' | 'custom'

/** Activity-feed tabs. Only `all`/`inference` exist in this ledger; the rest are honest-empty. */
export type ActivityTab = 'all' | 'inference' | 'deployments' | 'jobs' | 'payments'

export type UsageOverviewParams = {
  range?: UsageRange
  /** custom range start (RFC3339 or unix seconds). */
  start?: string
  /** custom range end (RFC3339 or unix seconds). */
  end?: string
  topModels?: number
  activityType?: ActivityTab
  activityLimit?: number
  activityOffset?: number
  /** Global-admin all-orgs god-view (forwards ?org=all). Tenants stay scoped. */
  allOrgs?: boolean
  /** Global-admin explicit org target (forwards ?org=<slug>); ignored for tenants. */
  org?: string
}

export const UsageApi = {
  overview: (p: UsageOverviewParams = {}): Promise<CloudUsageOverview> =>
    get<CloudUsageOverview>('get-cloud-usages', {
      range: p.range,
      start: p.start,
      end: p.end,
      topModels: p.topModels,
      activityType: p.activityType,
      activityLimit: p.activityLimit,
      activityOffset: p.activityOffset,
      org: p.allOrgs ? 'all' : p.org,
    }),
}
