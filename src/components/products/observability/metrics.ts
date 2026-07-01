/**
 * Pure metric aggregation for the org-wide observability dashboard.
 *
 * The Metrics surface is Langfuse-style analytics — trace volume, spend, latency,
 * token usage, model mix, and score summaries — computed over the org's REAL o11y
 * rows (the SAME `/v1/o11y/{traces,observations,scores}` surfaces the Traces /
 * Observations / Scores lists read). Because those calls go through the o11y
 * client, they carry `X-Org-Id` (`currentOrg()`) and only add `X-Project-Id` when
 * a project is selected — so this dashboard is ORGANISATION-WIDE on login and
 * narrows to a project the moment one is picked. Every number below is a fold over
 * rows the backend actually returned: empty input rolls up to zeros / empty series
 * (honest-empty), never a fabricated value.
 *
 * These are pure functions (rows in, aggregates out) so the module is a thin
 * render over them and they can be unit-tested in isolation.
 */
import type { Observation, Score, Trace } from '~/lib/api'

/** A point on a temporal axis — structurally the chart's `ChartPoint`. */
export type MetricPoint = { label: string; value: number }

/** Selectable lookback window over the fetched sample. */
export type MetricsRange = '24h' | '7d' | '30d'

/** Window length in days, for the time axis and the empty-day fill. */
export const METRICS_RANGE_DAYS: Record<MetricsRange, number> = { '24h': 1, '7d': 7, '30d': 30 }

/** The headline totals shown in the KPI tiles. */
export type MetricTotals = {
  /** Traces in the window. */
  traces: number
  /** Total spend across those traces, USD. */
  cost: number
  /** Total tokens across the window's observations. */
  tokens: number
  /** Mean end-to-end latency, seconds; null when no trace reported latency. */
  avgLatency: number | null
  /** 95th-percentile latency, seconds; null when no trace reported latency. */
  p95Latency: number | null
}

/** A per-model rollup row (from observations), sorted by request volume. */
export type ModelMetric = {
  /** Model id from the observation; `unknown` when the row carried none. */
  model: string
  /** Observations (generations/spans) attributed to the model. */
  observations: number
  /** Tokens summed across those observations. */
  tokens: number
}

/** A per-name score rollup row. */
export type ScoreMetric = {
  name: string
  /** NUMERIC | CATEGORICAL | BOOLEAN | TEXT (the first data type seen). */
  dataType: string
  count: number
  /** Mean numeric value; null for non-numeric scores (no meaningful average). */
  average: number | null
}

/** Parse an ISO/RFC3339 timestamp to epoch ms; null when missing/unparseable. */
export const toMs = (v?: string | null): number | null => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** Inclusive lower bound (ms) for a range, relative to `now`. */
export const rangeStart = (range: MetricsRange, now: number): number =>
  now - METRICS_RANGE_DAYS[range] * 86_400_000

/**
 * Keep only rows whose timestamp is inside the window `[rangeStart, now]`. A row
 * with no parseable timestamp is DROPPED from a windowed view (it can't be placed
 * on the time axis and would distort a range total) — honest over guessy.
 */
export function withinRange<T>(rows: T[], at: (row: T) => number | null, range: MetricsRange, now: number): T[] {
  const from = rangeStart(range, now)
  return rows.filter((r) => {
    const t = at(r)
    return t !== null && t >= from && t <= now
  })
}

/** Trace / observation / score timestamp accessors (epoch ms, null-safe). */
export const traceAt = (t: Trace): number | null => toMs(t.timestamp)
export const observationAt = (o: Observation): number | null => toMs(o.startTime)
export const scoreAt = (s: Score): number | null => toMs(s.timestamp)

/** Tokens on an observation (`usage.total`), 0 when unreported. */
const obsTokens = (o: Observation): number => {
  const t = o.usage?.total
  return typeof t === 'number' && Number.isFinite(t) ? t : 0
}

/** The p-th percentile (0–100) of a numeric set; null when empty. Nearest-rank. */
export function percentile(values: number[], p: number): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const rank = Math.ceil((p / 100) * clean.length)
  return clean[Math.min(clean.length - 1, Math.max(0, rank - 1))]
}

/** Roll a set of traces + observations up into the window totals. */
export function totals(traces: Trace[], observations: Observation[]): MetricTotals {
  let cost = 0
  const latencies: number[] = []
  for (const t of traces) {
    if (typeof t.totalCost === 'number' && Number.isFinite(t.totalCost)) cost += t.totalCost
    if (typeof t.latency === 'number' && Number.isFinite(t.latency)) latencies.push(t.latency)
  }
  const tokens = observations.reduce((sum, o) => sum + obsTokens(o), 0)
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null
  return { traces: traces.length, cost, tokens, avgLatency, p95Latency: percentile(latencies, 95) }
}

/** Local `YYYY-M-D` key for an epoch-ms instant (day bucketing). */
const dayKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** Short `M/D` axis label for an epoch-ms instant. */
const dayLabel = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * Roll rows up to a DENSE per-day series across the whole window, so the chart
 * shows zero-days (no gaps) and is comparable across ranges. `value` is summed per
 * day (1 per row for counts, cost/tokens for sums). Ascending by day.
 */
export function dailySeries<T>(
  rows: T[],
  at: (row: T) => number | null,
  value: (row: T) => number,
  range: MetricsRange,
  now: number,
): MetricPoint[] {
  const days = METRICS_RANGE_DAYS[range]
  const dayMs = 86_400_000
  const buckets = new Map<string, MetricPoint>()
  // Seed every day in the window with zero so empty days render honestly.
  for (let i = days - 1; i >= 0; i--) {
    const ms = now - i * dayMs
    buckets.set(dayKey(ms), { label: dayLabel(ms), value: 0 })
  }
  for (const r of rows) {
    const t = at(r)
    if (t === null) continue
    const b = buckets.get(dayKey(t))
    if (b) b.value += value(r)
  }
  return Array.from(buckets.values())
}

/** Roll observations up per model, sorted by observation count then tokens (desc). */
export function modelBreakdown(observations: Observation[]): ModelMetric[] {
  const by = new Map<string, ModelMetric>()
  for (const o of observations) {
    const model = o.model || 'unknown'
    const cur = by.get(model) ?? { model, observations: 0, tokens: 0 }
    cur.observations += 1
    cur.tokens += obsTokens(o)
    by.set(model, cur)
  }
  return Array.from(by.values()).sort((a, b) => b.observations - a.observations || b.tokens - a.tokens)
}

/** Roll scores up per name — count and (for numeric) mean value. Sorted by count (desc). */
export function scoreSummary(scores: Score[]): ScoreMetric[] {
  const by = new Map<string, { name: string; dataType: string; count: number; sum: number; numeric: number }>()
  for (const s of scores) {
    const cur = by.get(s.name) ?? { name: s.name, dataType: s.dataType, count: 0, sum: 0, numeric: 0 }
    cur.count += 1
    if (s.dataType === 'NUMERIC' && typeof s.value === 'number' && Number.isFinite(s.value)) {
      cur.sum += s.value
      cur.numeric += 1
    }
    by.set(s.name, cur)
  }
  return Array.from(by.values())
    .map((r) => ({
      name: r.name,
      dataType: r.dataType,
      count: r.count,
      average: r.numeric > 0 ? r.sum / r.numeric : null,
    }))
    .sort((a, b) => b.count - a.count)
}
