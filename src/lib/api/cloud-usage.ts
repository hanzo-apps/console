/**
 * Cloud usage read — the ONE canonical AI-usage overview for the console.
 *
 * SOURCE: the server-owned `GET /v1/ops/usages/cloud` (hanzoai/ai
 * controllers/cloud_usage.go), reached through the same-origin user-bearer `/v1`
 * proxy (`cloudGet`; cookie auth, the browser holds no bearer). The server
 * aggregates the `hanzo.cloud_usage` ledger into the `CloudUsageOverview` shape —
 * totals + prior-period deltas, an evenly-spaced series, spend-by-model, and the
 * recent-activity feed — scoped to the caller's org (a super admin may target one
 * org or all). NOTHING is re-derived client-side: this reads the value and
 * `<UsagePanel>` renders it, the SAME way on every Hanzo surface.
 *
 * The shape + the boundary-normalizer are the shared `@hanzo/usage` definitions,
 * so console never carries a second copy. A datastore-down ledger surfaces as an
 * `ApiError` ("usage ledger unavailable: datastore peer not connected") the caller
 * renders as an honest state — never fabricated zeros.
 */
import { cloudGet } from './client'
import { normalizeCloudUsage, type CloudUsageOverview, type UsageRange } from '@hanzo/usage'

export type { CloudUsageOverview, UsageRange } from '@hanzo/usage'

export type CloudUsageParams = {
  /** Super-admin only: target org slug, or `all` for every org (tenants stay scoped). */
  org?: string
  /** spend-by-model top-N (default 6). */
  topModels?: number
  /** recent-activity page size (default 20). */
  activityLimit?: number
}

export const CloudUsageApi = {
  /** Read the org's usage overview for a range. Throws `ApiError` on an
   *  unreachable/erroring ledger — the caller shows an honest state. */
  overview: async (range: UsageRange, p: CloudUsageParams = {}): Promise<CloudUsageOverview> => {
    const raw = await cloudGet<unknown>('ops/usages/cloud', {
      range,
      topModels: p.topModels ?? 6,
      activityType: 'all',
      activityLimit: p.activityLimit ?? 20,
      ...(p.org ? { org: p.org } : {}),
    })
    return normalizeCloudUsage(raw)
  },
}
