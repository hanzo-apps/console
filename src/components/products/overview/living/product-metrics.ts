/**
 * Per-product Metrics — the shared, product-parameterized LivingOverview config that
 * backs EVERY product's Metrics sub-page. ONE dashboard, one real source: the commerce
 * usage ledger (`UsageApi.overview`, the SAME source AI-Metrics + the platform overview
 * read), scoped to the product. No product writes Metrics UI — it inherits this config,
 * rendered by the ONE `LivingOverview`. Reuses the tile set + `ui/Charts` verbatim.
 *
 * Honest per-product attribution (the ONE decision lives in `subpage/sources.ts` →
 * `metricsScopeFor`, so there is exactly one "which products are the inference surface"
 * set): a `product`-scoped surface filters the ledger to its own `metadata.product` tag
 * (honest-empty until cloud attributes spend to it) and NEVER shows the org aggregate
 * under its name; the raw model-serving surface (inference/models/api/gateway) reads the
 * FULL ledger — which is entirely inference calls flowing through it — and the subtitle +
 * the view's banner frame it as org-wide inference, not a fabricated per-product slice.
 *
 * TWO real sources, because they answer different questions and neither can stand in for the
 * other. The commerce ledger knows what was BILLED (tokens, spend, model mix) and is empty for
 * a product that bills nothing; the o11y RED read
 * (`O11yMetricsApi.service` → `GET /v1/o11y/product/metrics`, derived from `event.span`) knows
 * what was SERVED (requests, error rate, p95) and is populated for any instrumented service.
 * So a product like Vector or IAM — no billed spend, real traffic — now has a Metrics board
 * with real numbers on it instead of an honest-but-empty ledger view.
 *
 * Where they overlap, TELEMETRY WINS and says so: `requests` and the requests-over-time series
 * come from o11y when it reported data, falling back to the ledger's billed-call count. Error
 * rate and p95 have no ledger equivalent at all, so they are o11y or an honest em-dash — never
 * a fabricated zero. The p95 is labelled p95 because that is what the endpoint returns.
 *
 * NOT USED: `POST /v1/o11y/services`. That read builds `FROM o11y_traces.<table>`, a database
 * which does not exist on the datastore, so it fails every time. The per-product read above is
 * the healthy, org-scoped replacement.
 */
import { Activity, AlertTriangle, DollarSign, Hash, Timer } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import { UsageApi } from '~/lib/api/usage'
import { O11yMetricsApi, type MetricPoint } from '~/lib/api/o11y-metrics'
import { metricsScopeFor, o11yServiceFor } from '~/components/products/subpage/sources'
import type { LivingOverviewConfig, OverviewRange, OverviewSeries } from './config'
import { fromCloudUsage } from './adapters'

const usageRange = (r: OverviewRange): '24h' | '7d' | '30d' => r

/** The o11y window matches the metrics range (seconds). The endpoint caps at 7d, so a 30d
 *  board asks for the most it can serve and the tiles say what they actually cover. */
const RANGE_SECONDS: Record<OverviewRange, number> = { '24h': 86_400, '7d': 604_800, '30d': 604_800 }

/** o11y `{t,v}` → the overview's `{t,value}`. Bucket cadence is the backend's (~60 buckets). */
const toSeries = (points: MetricPoint[], interval: 'hour' | 'day'): OverviewSeries => ({
  interval,
  points: points.map((p) => ({ t: p.t, value: p.v })),
})

/** The per-product Metrics ledger filter — the `metadata.product` tag, or null (whole
 *  inference ledger) for a raw model-serving surface. Thin accessor over the ONE
 *  decision in `subpage/sources.ts`; kept for callers that want just the filter value. */
export function metricsProductFilter(id: string): string | null {
  return metricsScopeFor(id).product
}

/**
 * The per-product Metrics dashboard config — REAL per-org usage scoped to `entry`.
 * Rows: 4 KPIs (requests/tokens/spend/P95 latency, each with a delta vs prior + a live
 * sparkline), 2 time charts (usage + spend over time), 3 breakdowns (top models by
 * tokens, requests by status, spend by model — all real donuts), and a recent-usage feed.
 */
export function productMetricsConfig(entry: CatalogEntry): LivingOverviewConfig {
  const { product, scope } = metricsScopeFor(entry.id)
  const o11yService = o11yServiceFor(entry)
  const subtitle =
    scope === 'inference-all'
      ? `Org-wide inference — every model call flows through ${entry.label}, per organization.`
      : `Traffic served by ${entry.label}, with the usage and spend attributed to it, per organization.`
  return {
    id: `metrics:${entry.id}`,
    title: 'Metrics',
    subtitle,
    live: { pollMs: 20000, countUp: true },
    rows: [
      [
        { tile: 'metric', key: 'requests', label: 'Requests', icon: Activity },
        { tile: 'metric', key: 'errorRatePct', label: 'Error rate', icon: AlertTriangle, unit: 'pct' },
        { tile: 'metric', key: 'latencyP95', label: 'Latency (p95)', icon: Timer, unit: 'ms' },
        { tile: 'metric', key: 'tokens', label: 'Total Tokens', icon: Hash },
        { tile: 'metric', key: 'spendCents', label: 'Total Spend', icon: DollarSign, unit: 'cents' },
      ],
      [
        { tile: 'timeseries', key: 'requests', title: 'Requests over time' },
        { tile: 'timeseries', key: 'errors', title: 'Errors over time' },
        { tile: 'timeseries', key: 'spendCents', title: 'Spend over time (USD)', kind: 'bar', unit: 'cents' },
      ],
      [
        { tile: 'distribution', key: 'byModelTokens', title: 'Top models by usage', centerLabel: 'tokens' },
        { tile: 'distribution', key: 'byStatus', title: 'Requests by status', centerLabel: 'requests' },
        { tile: 'distribution', key: 'byModel', title: 'Spend by model', centerLabel: 'total', unit: 'cents' },
      ],
      [{ tile: 'activity', title: 'Recent usage', empty: `No usage attributed to ${entry.label} in this range yet.` }],
    ],
    // Fetch the REAL billed ledger and the LIVE o11y RED window in parallel, then fuse them.
    // Neither read can blank the board: `O11yMetricsApi.service` never throws (it resolves to
    // an honest not-connected), and a ledger failure surfaces through the driver's own error
    // state. Every tile is real data or an em-dash — nothing here fabricates a zero.
    load: async ({ range, allOrgs }) => {
      const [usage, red] = await Promise.all([
        UsageApi.overview({ range: usageRange(range), activityType: 'all', activityLimit: 12, topModels: 8, allOrgs, product }),
        o11yService ? O11yMetricsApi.service(o11yService, { rangeSec: RANGE_SECONDS[range] }) : Promise.resolve(null),
      ])
      const data = fromCloudUsage(usage)

      if (red?.hasData) {
        const interval = range === '24h' ? 'hour' : 'day'
        // Telemetry wins over the ledger for what was SERVED — the ledger only counts billed
        // calls, so it undercounts (or misses entirely) a service that bills nothing.
        data.kpi.requests = { value: red.summary.requests }
        data.series.requests = toSeries(red.requests, interval)
        data.series.errors = toSeries(red.errors, interval)
        // No ledger equivalent exists for either of these.
        data.kpi.errorRatePct = { value: red.summary.errorRate }
        data.kpi.latencyP95 = { value: red.summary.p95Ms }
      }
      return data
    },
  }
}
