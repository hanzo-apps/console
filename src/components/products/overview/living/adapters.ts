/**
 * LivingOverview adapters — the pure maps from each REAL data source onto the
 * normalized `OverviewData` the tiles read. One adapter per source; each is a thin,
 * testable projection that fabricates nothing (a source with no data → empty maps,
 * so the tiles render honest skeletons/em-dashes).
 *
 * This is what makes the overview reusable across every product: the tiles + driver
 * never learn a specific endpoint — an adapter shapes the source, a config names the
 * tiles, and the SAME `LivingOverview` renders them. The adapters live here (pure)
 * and the configs bind them to a loader in `registry.ts`.
 *
 *   - `fromCloudUsage`   ← `CloudUsageOverview` (commerce usage ledger; the platform
 *                          overview + AI-usage products).
 *   - `fromAdminOverview`← `AdminOverview` (the `/v1/admin/*` aggregate).
 *   - `fromFunctions`    ← `FunctionsApi` list + metrics (the Functions product).
 *   - `healthFromApps`   ← `PlatformApp[]` (operator inventory → the health tile),
 *                          composable INTO any of the above.
 */
import type { CloudUsageOverview } from '~/lib/api/usage'
import type { AdminOverview } from '~/lib/api/admin-overview'
import type { PlatformApp } from '~/lib/api/platform'
import type { ServerlessFunction, FunctionsMetrics, OverviewStats } from '~/lib/api/functions'
import type { OverviewData, OverviewEvent, OverviewHealth, OverviewPoint } from './config'

const empty = (): OverviewData => ({ kpi: {}, series: {}, distribution: {}, activity: [], alerts: [], health: [] })

/** Map the commerce usage overview (the platform/AI-usage source) onto `OverviewData`. */
export function fromCloudUsage(ov: CloudUsageOverview): OverviewData {
  const d = empty()
  d.kpi.tokens = { value: ov.totals.tokens, prior: ov.deltas.tokens?.prior, series: ov.series.map((p) => p.tokens) }
  d.kpi.spendCents = { value: ov.totals.spendCents, prior: ov.deltas.spendCents?.prior, series: ov.series.map((p) => p.spendCents) }
  d.kpi.requests = { value: ov.totals.requests, prior: ov.deltas.requests?.prior, series: ov.series.map((p) => p.requests) }
  d.kpi.models = { value: ov.totals.models, prior: ov.deltas.models?.prior, series: ov.series.map((p) => p.models) }

  d.series.tokens = { interval: ov.interval, points: ov.series.map((p) => ({ t: p.t, value: p.tokens })) }
  d.series.spendCents = { interval: ov.interval, points: ov.series.map((p) => ({ t: p.t, value: p.spendCents })) }
  d.series.requests = { interval: ov.interval, points: ov.series.map((p) => ({ t: p.t, value: p.requests })) }

  d.distribution.byModel = [
    ...ov.byModel.items.map((m) => ({ label: m.model, value: m.spendCents, sub: m.provider })),
    ...(ov.byModel.other ? [{ label: `Other (${ov.byModel.other.modelCount})`, value: ov.byModel.other.spendCents, sub: 'remaining models' }] : []),
  ]

  d.activity = ov.activity.items.map(
    (r): OverviewEvent => ({
      id: r.requestId || `${r.time}-${r.model}-${r.user}`,
      time: r.time,
      title: r.model ? `Inference · ${r.model}` : 'Inference',
      subtitle: [r.provider, r.tokens ? `${r.tokens.toLocaleString()} tokens` : ''].filter(Boolean).join(' · ') || undefined,
      status: r.status || 'success',
    }),
  )
  d.activityTotal = ov.activity.total
  return d
}

/** Map the `/v1/admin/*` aggregate onto `OverviewData`. */
export function fromAdminOverview(ov: AdminOverview): OverviewData {
  const d = empty()
  for (const k of ov.kpis) {
    const kpi: { value: number; prior?: number; series?: number[] } = { value: k.value }
    if (k.prior !== undefined) kpi.prior = k.prior
    if (k.series) kpi.series = k.series
    d.kpi[k.key] = kpi
  }
  for (const s of ov.series) d.series[s.key] = { interval: s.interval, points: s.points }
  const toSlices = (slices: { label: string; value: number; hint?: string }[]) =>
    slices.map((s) => ({ label: s.label, value: s.value, sub: s.hint }))
  if (ov.distribution.length) d.distribution.revenue = toSlices(ov.distribution)
  // Named business distributions (revenue by product, plan mix, top agents/bots by
  // cost, …) — each keyed exactly as the backend named it, so the business board's
  // tiles read them by that key. Never overwrites a slice the backend didn't send.
  if (ov.distributions) {
    for (const [key, slices] of Object.entries(ov.distributions)) {
      if (slices.length) d.distribution[key] = toSlices(slices)
    }
  }
  d.activity = ov.activity.map((a): OverviewEvent => ({ id: a.id, time: a.time, title: a.title, subtitle: a.subtitle, status: a.status }))
  d.alerts = ov.alerts.map((a) => ({ id: a.id, severity: a.severity, title: a.title, detail: a.detail }))
  d.health = ov.health.map((h): OverviewHealth => ({ service: h.service, health: h.health, detail: h.detail }))
  return d
}

/**
 * Sum every per-function line of a metrics series into one dense "total over time"
 * series, keyed + ordered by timestamp. Pure — reused by the Functions adapter.
 */
export function sumSeriesLines(series: FunctionsMetrics['series']): OverviewPoint[] {
  const byT = new Map<string, number>()
  for (const line of series) {
    for (const p of line.points) byT.set(p.t, (byT.get(p.t) ?? 0) + (Number.isFinite(p.v) ? p.v : 0))
  }
  return Array.from(byT.entries())
    .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
    .map(([t, value]) => ({ t, value }))
}

/**
 * Map the Functions product's real inventory + metrics onto `OverviewData`. The KPI
 * values come from `deriveOverview` (already the product's honest rollup); the series
 * + status distribution from `FunctionsApi.metrics` (null → empty maps, honest states).
 */
export function fromFunctions(stats: OverviewStats, metrics: FunctionsMetrics | null): OverviewData {
  const d = empty()
  d.kpi.functions = { value: stats.count }
  if (stats.invocations7d !== null) {
    const invSeries = metrics ? sumSeriesLines(metrics.series).map((p) => p.value) : undefined
    const kpi: { value: number; prior?: number; series?: number[] } = { value: stats.invocations7d }
    if (invSeries && invSeries.length >= 2) kpi.series = invSeries
    d.kpi.invocations = kpi
  }
  if (stats.successRate !== null) d.kpi.success = { value: Math.round(stats.successRate * 100) }
  if (stats.avgDurationMs !== null) d.kpi.duration = { value: stats.avgDurationMs }
  if (stats.errors7d !== null) d.kpi.errors = { value: stats.errors7d }

  if (metrics && metrics.series.length) {
    const points = sumSeriesLines(metrics.series)
    // The metrics grid points are hourly for short ranges; the axis formats either way.
    if (points.length) d.series.invocations = { interval: 'hour', points }
  }
  if (metrics) {
    const { success, timeout, error } = metrics.status
    if (success + timeout + error > 0) {
      d.distribution.status = [
        { label: 'Success', value: success },
        { label: 'Timeout', value: timeout },
        { label: 'Error', value: error },
      ]
    }
  }
  return d
}

/**
 * Project the operator apps inventory into health rows — composable into any
 * overview's health tile. Dedupes to one row per app (the latest observation) and
 * keeps the real `health` verdict. Empty inventory → no rows (honest "not reporting").
 */
export function healthFromApps(apps: PlatformApp[]): OverviewHealth[] {
  const byApp = new Map<string, OverviewHealth>()
  for (const a of apps) {
    const key = a.app || a.id
    if (!key) continue
    byApp.set(key, { service: a.app || a.id, health: a.health, detail: a.cluster })
  }
  return Array.from(byApp.values()).sort((x, y) => x.service.localeCompare(y.service))
}
