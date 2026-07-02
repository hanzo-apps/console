/**
 * Pure billing-center logic — the forecast + cost-breakdown math, separated from
 * the React surfaces so it is unit-testable without the GUI tree (the same split
 * as `embeddings/logic.ts`, `marketplace/logic.ts`).
 *
 * Every function is a projection over the REAL commerce usage ledger records
 * (`UsageRecord` from `lib/api/aimetrics`, parsed from `GET /v1/billing/usage`) —
 * nothing is fabricated: no records → zeros/empty, and a record with no parseable
 * timestamp is dropped from time-windowed views (it can't be placed on the axis),
 * honest over guessy. Money is USD cents end-to-end.
 */
import { dailySeries, type RangeKey, type UsageRecord } from '~/lib/api/aimetrics'

/** Month-to-date spend + a clearly-linear projection to month end. */
export type MonthForecast = {
  /** Spend so far this calendar month, USD cents. */
  spentCents: number
  /** 1-based day-of-month for `now` (days elapsed, inclusive of today). */
  dayOfMonth: number
  /** Total days in `now`'s month. */
  daysInMonth: number
  /**
   * Linear month-end projection: `spentCents / dayOfMonth * daysInMonth`. This is
   * a naive run-rate extrapolation, LABELLED as such in the UI (never presented as
   * a real forecast). `null` before any day has elapsed (no basis) — honest "—".
   */
  projectedCents: number | null
}

/** Local start-of-month epoch ms for an instant. */
function startOfMonth(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Days in the calendar month containing `now`. */
export function daysInMonth(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/**
 * Month-to-date spend from the ledger + a linear month-end projection. Only records
 * inside `[startOfMonth(now), now]` count; undated records are ignored (they can't
 * be attributed to a month). The projection is a pure run-rate line, never fabricated.
 */
export function monthToDate(records: UsageRecord[], now: number): MonthForecast {
  const start = startOfMonth(now)
  const total = daysInMonth(now)
  const dayOfMonth = new Date(now).getDate()
  let spentCents = 0
  for (const r of records) {
    if (r.at === null) continue
    if (r.at >= start && r.at <= now) spentCents += r.cents
  }
  const projectedCents = dayOfMonth > 0 ? Math.round((spentCents / dayOfMonth) * total) : null
  return { spentCents, dayOfMonth, daysInMonth: total, projectedCents }
}

/**
 * The dimension a cost breakdown groups by. The ledger carries `model`/`provider`
 * on every inference row, and — when cloud tags the spend — `product` (the surface:
 * agents/chat/search/…) and `agent` (the `<org>-<agent>` identity). So Dave can see
 * "which agent cost me $X" and "which product cost me $X". A dimension is only ever
 * OFFERED when ≥1 record carries it (`presentDimensions`), never invented.
 */
export type SpendDimension = 'model' | 'provider' | 'product' | 'agent'

/** The ledger field a dimension reads. */
function dimValue(r: UsageRecord, by: SpendDimension): string {
  switch (by) {
    case 'model':
      return r.model
    case 'provider':
      return r.provider
    case 'product':
      return r.product
    case 'agent':
      return r.agent
  }
}

/** One grouped cost row — spend + volume for one dimension value. */
export type SpendGroup = {
  /** The dimension value (model/provider/product/agent); 'unknown' when the ledger omits it. */
  label: string
  /** Provider (kept even when grouping by another dimension, for a secondary column). */
  provider: string
  /** Spend for the group, USD cents. */
  cents: number
  /** Requests in the group. */
  requests: number
  /** Total tokens in the group. */
  tokens: number
}

/** Group ledger records by a present dimension, sorted by spend desc then requests desc. */
export function groupSpend(records: UsageRecord[], by: SpendDimension): SpendGroup[] {
  const map = new Map<string, SpendGroup>()
  for (const r of records) {
    const raw = dimValue(r, by)
    const key = raw || 'unknown'
    const cur =
      map.get(key) ?? { label: raw || 'unknown', provider: r.provider, cents: 0, requests: 0, tokens: 0 }
    cur.cents += r.cents
    cur.requests += 1
    cur.tokens += r.totalTokens
    if (!cur.provider && r.provider) cur.provider = r.provider
    map.set(key, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.cents - a.cents || b.requests - a.requests)
}

/** Substring filter over a group's label + provider (literal, injection-safe). */
export function filterGroups(groups: SpendGroup[], query: string): SpendGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups.filter((g) => `${g.label} ${g.provider}`.toLowerCase().includes(q))
}

/**
 * Which breakdown dimensions the ledger actually supports — a dimension is offered
 * only if ≥1 record carries a non-empty value for it. `model` is always present
 * (every inference row has one, even if 'unknown'); `provider`, `product`, and
 * `agent` appear ONLY when the ledger reports them. Omitting an absent dimension
 * keeps the UI honest — the agent/product breakdown lights up automatically the
 * moment cloud starts tagging spend with `metadata.{product,agent}`, and shows
 * nothing (never a fabricated column) until then. Display order: model, provider,
 * product, agent.
 */
export function presentDimensions(records: UsageRecord[]): SpendDimension[] {
  const dims: SpendDimension[] = ['model']
  if (records.some((r) => r.provider)) dims.push('provider')
  if (records.some((r) => r.product)) dims.push('product')
  if (records.some((r) => r.agent)) dims.push('agent')
  return dims
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** `YYYY-MM-DD` → `M/D` (short axis label). Falls back to the raw key. */
export function shortDay(dayKey: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(dayKey)
  return m ? `${Number(m[1])}/${Number(m[2])}` : dayKey
}

/** A point on the daily-spend chart — dollars (for the axis), labelled `M/D`. */
export type SpendPoint = { label: string; value: number }

/**
 * Dense per-day spend series over a range (zero-days filled) in DOLLARS, for the
 * spend-trend chart. Reuses the shared `dailySeries` roll-up so Overview, Reports,
 * and AI Metrics agree to the cent.
 */
export function dailySpend(records: UsageRecord[], range: RangeKey, now: number): SpendPoint[] {
  return dailySeries(records, range, now).map((b) => ({ label: shortDay(b.day), value: round2(b.cents / 100) }))
}
