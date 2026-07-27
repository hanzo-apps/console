/**
 * Cloud usage client — the read side of the Overview dashboard.
 *
 * SOURCE: the REAL commerce usage ledger (`GET /v1/billing/usage`) through the
 * console's OWN per-tenant `/v1/billing/*` proxy (`app/v1/billing/[...path]/route.ts`),
 * which injects the commerce service token server-side and scopes every request
 * to the caller's own org/billing-subject — the SAME subject the gateway debits
 * and the Cost page reads. This deliberately does NOT use cloud `get-cloud-usages`
 * anymore: that endpoint returns 200 with `{"status":"error","msg":"usage ledger
 * unavailable: datastore peer not connected"}` (its o11y/datastore peer is down),
 * so the customer saw no spend. "Billing IS commerce" — the Overview reads the one
 * real, charged source, and `usage-adapter.ts` rolls the raw records up into the
 * rich `CloudUsageOverview` the dashboard renders (reusing the aimetrics parse, so
 * Overview and Cost agree to the cent).
 *
 * Money is USD cents end-to-end. A delta `pct` is `null` when the prior period
 * had no basis, so the UI shows an honest "—" rather than a fabricated ratio.
 */
import { fetchUsageRecords } from './aimetrics'
import { buildCloudUsageOverview } from './usage-adapter'

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

export type CloudUsageStatusSlice = {
  /** The recorded gateway/provider status for the call (e.g. `success`, `error`). */
  status: string
  requests: number
  /** Share of total requests, 0..100. */
  pct: number
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
  /** Requests grouped by recorded status (Success/Error/…) — the real status breakdown. */
  byStatus: CloudUsageStatusSlice[]
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
  /**
   * Attribute the ledger to ONE product (`metadata.product`) before rolling it up —
   * the per-product Metrics dashboard. `null`/undefined = the whole ledger (which is
   * entirely inference calls). Filtering is client-side over the same fetched records,
   * so it never widens scope; a product with no attributed rows rolls up honest-empty.
   */
  product?: string | null
}

export const UsageApi = {
  /**
   * Fetch the tenant's usage ledger once (per-tenant `/billing/usage` proxy) and
   * roll it up into the dashboard overview for the requested range/tab/page. The
   * whole ledger is small per subject and the aggregation is client-side, so
   * range/tab/pagination changes never widen scope — they re-slice the same real
   * records.
   */
  overview: async (p: UsageOverviewParams = {}): Promise<CloudUsageOverview> => {
    const records = await fetchUsageRecords()
    return buildCloudUsageOverview(records, {
      range: p.range ?? '24h',
      start: p.start,
      end: p.end,
      topModels: p.topModels ?? 6,
      activityType: p.activityType ?? 'all',
      activityLimit: p.activityLimit ?? 8,
      activityOffset: p.activityOffset ?? 0,
      now: Date.now(),
      allOrgs: p.allOrgs,
      product: p.product ?? null,
    })
  },
}
