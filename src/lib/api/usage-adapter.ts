/**
 * Overview usage adapter — builds the rich `CloudUsageOverview` the dashboard
 * renders from the REAL commerce usage ledger (`GET /v1/billing/usage`, via the
 * console's per-tenant `/billing/*` proxy), NOT the cloud `get-cloud-usages`
 * datastore (which returns "datastore peer not connected" — the ledger's o11y
 * peer is down). "Billing IS commerce": the Overview now reads the SAME source
 * the Cost page and the gateway debit against, so what it shows is what was
 * charged — never a fabricated or dead-ledger number.
 *
 * Every function here is pure over `UsageRecord[]` (the ONE canonical parse from
 * `aimetrics.ts`, reused for totals/per-model rollups so Overview and Cost agree
 * to the cent). The window (24h/7d/30d/custom) is applied here on `createdAt`
 * (commerce does not time-filter), and the prior-period delta is the immediately
 * preceding window of equal length — `null` percent when the prior had no basis,
 * so the UI shows an honest "—" rather than a fabricated ratio.
 */
import { perModel, totalsOf, type UsageRecord } from './aimetrics'
import type {
  ActivityTab,
  CloudUsageActivity,
  CloudUsageActivityRow,
  CloudUsageByModel,
  CloudUsageDelta,
  CloudUsageOverview,
  CloudUsageSeriesPoint,
  CloudUsageTotals,
  UsageRange,
} from './usage'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Bucket granularity for the time-series charts. Mirrors the cloud ledger's `interval`. */
export type SeriesInterval = 'hour' | 'day'

/** All the (already-defaulted) inputs the adapter needs; `now` is injected for tests. */
export type AdapterParams = {
  range: UsageRange
  /** custom range start (RFC3339 or unix seconds), only for range === 'custom'. */
  start?: string
  /** custom range end (RFC3339 or unix seconds), only for range === 'custom'. */
  end?: string
  topModels: number
  activityType: ActivityTab
  activityLimit: number
  activityOffset: number
  /** Wall clock in ms — injected so the pure build is deterministic under test. */
  now: number
  /** Preserved from the caller; the per-tenant proxy is always own-org scoped. */
  allOrgs?: boolean
}

/** Parse an RFC3339 string or unix-seconds/ms number to epoch ms; null when unusable. */
function parseBound(v: string | undefined): number | null {
  if (!v) return null
  if (/^\d+$/.test(v)) {
    const n = Number(v)
    // Heuristic: 10-digit values are unix seconds, 13-digit are ms.
    return n < 1e12 ? n * 1000 : n
  }
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** Resolve the [from, to] window (ms) and the series interval for a range. */
export function windowFor(p: AdapterParams): { from: number; to: number; interval: SeriesInterval } {
  if (p.range === 'custom') {
    const to = parseBound(p.end) ?? p.now
    const from = parseBound(p.start) ?? to - 7 * DAY
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    return { from: lo, to: hi, interval: hi - lo <= 2 * DAY ? 'hour' : 'day' }
  }
  if (p.range === '24h') return { from: p.now - DAY, to: p.now, interval: 'hour' }
  if (p.range === '7d') return { from: p.now - 7 * DAY, to: p.now, interval: 'day' }
  return { from: p.now - 30 * DAY, to: p.now, interval: 'day' }
}

/** Keep only records whose timestamp is inside the inclusive window. Undated dropped. */
export function inWindow(records: UsageRecord[], from: number, to: number): UsageRecord[] {
  return records.filter((r) => r.at !== null && r.at >= from && r.at <= to)
}

/** Distinct non-empty values of a field across records. */
function distinct(records: UsageRecord[], pick: (r: UsageRecord) => string): number {
  const set = new Set<string>()
  for (const r of records) {
    const v = pick(r)
    if (v) set.add(v)
  }
  return set.size
}

/** Window totals for the metric cards — spend, tokens, requests, and model/provider counts. */
export function totalsFrom(records: UsageRecord[]): CloudUsageTotals {
  const t = totalsOf(records)
  return {
    tokens: t.totalTokens,
    promptTokens: t.promptTokens,
    completionTokens: t.completionTokens,
    requests: t.requests,
    spendCents: t.cents,
    models: distinct(records, (r) => r.model),
    providers: distinct(records, (r) => r.provider),
  }
}

/** A current-vs-prior delta; percent is null when the prior period had no basis (honest "—"). */
export function delta(current: number, prior: number): CloudUsageDelta {
  const pct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : null
  return { current, prior, pct }
}

/** Floor an instant to the start of its bucket (UTC hour or UTC day). */
function bucketStart(ms: number, interval: SeriesInterval): number {
  const step = interval === 'hour' ? HOUR : DAY
  return Math.floor(ms / step) * step
}

/**
 * Dense time-series across the whole window (zero-buckets seeded so the chart has
 * no gaps), ascending. Each point carries tokens, spend, requests, and the count
 * of distinct models active in that bucket — the four series the cards spark.
 */
export function buildSeries(
  records: UsageRecord[],
  from: number,
  to: number,
  interval: SeriesInterval,
): CloudUsageSeriesPoint[] {
  const step = interval === 'hour' ? HOUR : DAY
  type Bucket = { tokens: number; spendCents: number; requests: number; models: Set<string> }
  const buckets = new Map<number, Bucket>()
  const start = bucketStart(from, interval)
  const end = bucketStart(to, interval)
  for (let t = start; t <= end; t += step) {
    buckets.set(t, { tokens: 0, spendCents: 0, requests: 0, models: new Set() })
  }
  for (const r of records) {
    if (r.at === null) continue
    const b = buckets.get(bucketStart(r.at, interval))
    if (!b) continue
    b.tokens += r.totalTokens
    b.spendCents += r.cents
    b.requests += 1
    if (r.model) b.models.add(r.model)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({
      t: new Date(t).toISOString(),
      tokens: b.tokens,
      spendCents: b.spendCents,
      requests: b.requests,
      models: b.models.size,
    }))
}

const pctOf = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/** Spend-by-model: the top-N models by spend plus a single rolled-up "Other" bucket. */
export function buildByModel(records: UsageRecord[], topN: number): CloudUsageByModel {
  const rolled = perModel(records) // already sorted by spend desc, then requests desc
  const totalCents = rolled.reduce((a, m) => a + m.cents, 0)
  const top = rolled.slice(0, Math.max(0, topN))
  const rest = rolled.slice(Math.max(0, topN))
  const items = top.map((m) => ({
    model: m.model || 'unknown',
    provider: m.provider,
    spendCents: m.cents,
    tokens: m.totalTokens,
    requests: m.requests,
    pct: pctOf(m.cents, totalCents),
  }))
  const other =
    rest.length > 0
      ? {
          spendCents: rest.reduce((a, m) => a + m.cents, 0),
          tokens: rest.reduce((a, m) => a + m.totalTokens, 0),
          requests: rest.reduce((a, m) => a + m.requests, 0),
          pct: pctOf(
            rest.reduce((a, m) => a + m.cents, 0),
            totalCents,
          ),
          modelCount: rest.length,
        }
      : null
  return { items, other, totalCents }
}

/** Map one usage record to an activity row (every billed row is a completed inference). */
function toActivityRow(r: UsageRecord): CloudUsageActivityRow {
  return {
    time: r.at !== null ? new Date(r.at).toISOString() : '',
    model: r.model,
    provider: r.provider,
    type: 'inference',
    status: r.status || 'success',
    tokens: r.totalTokens,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    costCents: r.cents,
    stream: r.stream,
    premium: r.premium,
    requestId: r.requestId || r.id,
    org: '',
    user: '',
  }
}

/**
 * Recent-activity feed for a tab, newest first, paginated. The commerce ledger is
 * inference-only, so `deployments`/`jobs`/`payments` are honest-empty (the UI
 * points at Platform/Tasks/Cost for those) rather than fabricated.
 */
export function buildActivity(
  records: UsageRecord[],
  tab: ActivityTab,
  limit: number,
  offset: number,
): CloudUsageActivity {
  const relevant = tab === 'all' || tab === 'inference' ? records : []
  const sorted = [...relevant].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity))
  const total = sorted.length
  const items = sorted.slice(offset, offset + limit).map(toActivityRow)
  return { items, limit, offset, total, type: tab }
}

/** Assemble the full `CloudUsageOverview` the dashboard renders, purely from records. */
export function buildCloudUsageOverview(all: UsageRecord[], p: AdapterParams): CloudUsageOverview {
  const { from, to, interval } = windowFor(p)
  const current = inWindow(all, from, to)
  const span = to - from
  const prior = inWindow(all, from - span, from)

  const totals = totalsFrom(current)
  const priorTotals = totalsFrom(prior)
  const deltas: Record<string, CloudUsageDelta> = {
    tokens: delta(totals.tokens, priorTotals.tokens),
    spendCents: delta(totals.spendCents, priorTotals.spendCents),
    requests: delta(totals.requests, priorTotals.requests),
    models: delta(totals.models, priorTotals.models),
  }

  return {
    range: p.range,
    start: new Date(from).toISOString(),
    end: new Date(to).toISOString(),
    interval,
    scope: { org: '', allOrgs: Boolean(p.allOrgs) },
    totals,
    deltas,
    series: buildSeries(current, from, to, interval),
    byModel: buildByModel(current, p.topModels),
    activity: buildActivity(current, p.activityType, p.activityLimit, p.activityOffset),
  }
}
