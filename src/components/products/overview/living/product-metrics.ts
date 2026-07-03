/**
 * Per-product Metrics — the shared, product-parameterized LivingOverview config that
 * backs EVERY product's Metrics sub-page. ONE dashboard, one real source: the commerce
 * usage ledger (`UsageApi.overview`, the SAME source AI-Metrics + the platform overview
 * read), scoped to the product. No product writes Metrics UI — it inherits this config,
 * rendered by the ONE `LivingOverview`. Reuses the tile set + `ui/Charts` verbatim.
 *
 * Honest per-product attribution: a product with a real `metadata.product` tag filters
 * to its own rows (honest-empty until cloud attributes spend to it); the raw model-
 * serving surfaces (inference/models/api/gateway) read the FULL ledger, which is
 * entirely inference calls — so "Inference metrics = the whole ledger" is exact, never
 * a misattribution. P95 latency has no ledger source, so its tile renders an honest "—"
 * until o11y trace latency is wired in (flagged, never fabricated).
 */
import { Activity, DollarSign, Hash, Timer } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import { UsageApi } from '~/lib/api/usage'
import type { LivingOverviewConfig, OverviewRange } from './config'
import { fromCloudUsage } from './adapters'

const usageRange = (r: OverviewRange): '24h' | '7d' | '30d' => r

/**
 * Products whose usage IS the org's raw model-inference total. The commerce ledger is
 * ENTIRELY inference calls (every row is type "inference"), so these surfaces read the
 * FULL ledger, unfiltered. Every OTHER product filters by its own `metadata.product`
 * tag (honest-empty until attributed) — never showing the whole ledger under one
 * product's name.
 */
const RAW_INFERENCE_PRODUCTS = new Set<string>(['inference', 'models', 'api', 'gateway'])

/** The per-product Metrics ledger filter: null (the whole inference ledger) for a raw
 *  model-serving surface, else the product's own `metadata.product` tag. */
export function metricsProductFilter(id: string): string | null {
  return RAW_INFERENCE_PRODUCTS.has(id) ? null : id
}

/**
 * The per-product Metrics dashboard config — REAL per-org usage scoped to `entry`.
 * Rows: 4 KPIs (requests/tokens/spend/P95 latency, each with a delta vs prior + a live
 * sparkline), 2 time charts (usage + spend over time), 3 breakdowns (top models by
 * tokens, requests by status, spend by model — all real donuts), and a recent-usage feed.
 */
export function productMetricsConfig(entry: CatalogEntry): LivingOverviewConfig {
  const product = metricsProductFilter(entry.id)
  return {
    id: `metrics:${entry.id}`,
    title: 'Metrics',
    subtitle: `Usage and spend attributed to ${entry.label}, per organization.`,
    live: { pollMs: 20000, countUp: true },
    rows: [
      [
        { tile: 'metric', key: 'requests', label: 'Total Requests', icon: Activity },
        { tile: 'metric', key: 'tokens', label: 'Total Tokens', icon: Hash },
        { tile: 'metric', key: 'spendCents', label: 'Total Spend', icon: DollarSign, unit: 'cents' },
        { tile: 'metric', key: 'latencyP95', label: 'Avg. Latency (P95)', icon: Timer, unit: 'ms' },
      ],
      [
        { tile: 'timeseries', key: 'requests', title: 'Usage over time' },
        { tile: 'timeseries', key: 'spendCents', title: 'Spend over time (USD)', kind: 'bar', unit: 'cents' },
      ],
      [
        { tile: 'distribution', key: 'byModelTokens', title: 'Top models by usage', centerLabel: 'tokens' },
        { tile: 'distribution', key: 'byStatus', title: 'Requests by status', centerLabel: 'requests' },
        { tile: 'distribution', key: 'byModel', title: 'Spend by model', centerLabel: 'total', unit: 'cents' },
      ],
      [{ tile: 'activity', title: 'Recent usage', empty: `No usage attributed to ${entry.label} in this range yet.` }],
    ],
    load: async ({ range, allOrgs }) =>
      fromCloudUsage(
        await UsageApi.overview({ range: usageRange(range), activityType: 'all', activityLimit: 12, topModels: 8, allOrgs, product }),
      ),
  }
}
