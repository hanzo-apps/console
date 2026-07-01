/**
 * AI Metrics — the real per-org AI usage + spend behind the AI Metrics page.
 *
 * ONE real source: the commerce usage ledger `GET /v1/billing/usage`, reached
 * through the console's OWN same-origin `/billing/*` server proxy
 * (`app/billing/[...path]/route.ts`). That proxy injects the commerce SERVICE
 * token server-side and OVERWRITES any client `user`/`org` with the caller's own
 * org/billing-subject — the browser never holds a commerce credential and cannot
 * widen scope. The subject is the SAME one the gateway debits, so what this page
 * shows is exactly what the org was charged for. Balance comes from the same
 * proxy (`GET /v1/billing/balance`).
 *
 * The commerce usage payload is the RAW per-request ledger, NOT a pre-rolled
 * summary (see `commerce/api/billing/usage.go`): one record per API call carries
 * `amount` (positive USD cents = the cost charged), `createdAt`, and a `metadata`
 * map with `model`/`provider` and `promptTokens`/`completionTokens`/`totalTokens`.
 * The endpoint does NOT time-filter, so the time-range (24h/7d/30d) is applied
 * here, on `createdAt`. Every aggregation below is a pure function over those
 * records — testable, and reusable when these surfaces lift into `@hanzo/ui`.
 *
 * Nothing is fabricated: an org with no usage yet rolls up to zeros + empty
 * series/breakdowns (honest-empty), and a proxy failure throws a typed `ApiError`
 * the caller renders as an honest state — never placeholder spend.
 */
import { ApiError, restGet } from './client'
import type { CloudBalance } from './wallet'

/** Same-origin URL for the `/billing/*` server proxy (NOT the `/v1` gateway). */
const billingUrl = (path: string): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/billing/${path.replace(/^\/+/, '')}`
}

/**
 * One usage record as commerce returns it under `usage[]`. All fields are
 * optional-safe so a rename upstream degrades a value rather than throwing.
 * Mirrors the `gin.H` shape emitted by `billing.GetUsage` (commerce).
 */
export type UsageRecord = {
  /** The transaction id (used as a stable row key). */
  id: string
  /** Cost charged for this call, USD cents (positive; it is a withdraw). */
  cents: number
  /** Model the call hit (from metadata), e.g. `gpt-4o-mini`. '' when unknown. */
  model: string
  /** Provider that served it (from metadata), e.g. `openai`. '' when unknown. */
  provider: string
  /** Prompt (input) tokens, if reported. */
  promptTokens: number
  /** Completion (output) tokens, if reported. */
  completionTokens: number
  /** Total tokens, if reported (falls back to prompt+completion). */
  totalTokens: number
  /** When the call happened (ISO), parsed to epoch ms; null when unparseable. */
  at: number | null
  /** The free-text note commerce stores, e.g. "API usage: gpt-4o-mini (1234 tokens)". */
  notes: string
  /** True when the call hit a premium (paid-tier) model — from metadata. */
  premium: boolean
  /** True when the response was streamed — from metadata. */
  stream: boolean
  /** Provider/gateway status for the call (e.g. `success`) — from metadata; '' when absent. */
  status: string
  /** Gateway request id (from metadata) for tracing; '' when absent. */
  requestId: string
}

/** A point in the per-day usage series — one calendar day in the window. */
export type DayBucket = {
  /** `YYYY-MM-DD` (local day key). */
  day: string
  /** Requests on the day. */
  requests: number
  /** Total tokens on the day. */
  tokens: number
  /** Spend on the day, USD cents. */
  cents: number
}

/** A per-model rollup row — requests, tokens, and spend for one model. */
export type ModelUsage = {
  /** The raw model id from the ledger (joined to the catalog for a display name). */
  model: string
  /** Provider, if the ledger carried one. */
  provider: string
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cents: number
}

/** The window totals shown in the stat tiles. */
export type UsageTotals = {
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cents: number
}

/** A selectable lookback window. */
export type RangeKey = '24h' | '7d' | '30d'

/** Window length in days, for the time axis + the empty-day fill. */
export const RANGE_DAYS: Record<RangeKey, number> = { '24h': 1, '7d': 7, '30d': 30 }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true

/** Parse an ISO/RFC3339 (or epoch) timestamp to ms; null when unparseable. */
const epochMs = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** Pull the usage array from the commerce envelope (`{ usage: [...] }`) or a bare list. */
const usageArray = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    const v = (payload as Record<string, unknown>).usage
    if (Array.isArray(v)) return v as Record<string, unknown>[]
  }
  return []
}

/** Normalize one raw commerce record into a `UsageRecord`. */
export function normalizeRecord(r: Record<string, unknown>, i: number): UsageRecord {
  const meta = (r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {})
  const prompt = num(meta.promptTokens)
  const completion = num(meta.completionTokens)
  const total = num(meta.totalTokens) || prompt + completion
  // `amount` is a withdraw in positive cents (commerce RecordUsage); take the
  // magnitude so a sign-convention change upstream can never flip cost negative.
  const cents = Math.abs(num(r.amount) || num(r.cents))
  return {
    id: str(r.transactionId) || str(r.id) || `usage-${i}`,
    cents,
    model: str(meta.model),
    provider: str(meta.provider),
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    at: epochMs(r.createdAt) ?? epochMs(r.timestamp),
    notes: str(r.notes),
    premium: bool(meta.premium),
    stream: bool(meta.stream),
    status: str(meta.status),
    requestId: str(meta.requestId) || str(r.requestId),
  }
}

/** Normalize the whole `/v1/billing/usage` payload into typed records. */
export function normalizeUsageRecords(payload: unknown): UsageRecord[] {
  return usageArray(payload).map(normalizeRecord)
}

/** Inclusive lower bound (ms) for a range, relative to `now`. */
export function rangeStart(range: RangeKey, now: number): number {
  return now - RANGE_DAYS[range] * 24 * 60 * 60 * 1000
}

/**
 * Keep only records inside the window `[rangeStart, now]`. A record with no
 * parseable timestamp is DROPPED from a windowed view (it cannot be placed on the
 * time axis and would distort the totals for a chosen range) — honest over guessy.
 */
export function withinRange(records: UsageRecord[], range: RangeKey, now: number): UsageRecord[] {
  const from = rangeStart(range, now)
  return records.filter((r) => r.at !== null && r.at >= from && r.at <= now)
}

/** Sum a set of records into the window totals. */
export function totalsOf(records: UsageRecord[]): UsageTotals {
  return records.reduce<UsageTotals>(
    (acc, r) => ({
      requests: acc.requests + 1,
      promptTokens: acc.promptTokens + r.promptTokens,
      completionTokens: acc.completionTokens + r.completionTokens,
      totalTokens: acc.totalTokens + r.totalTokens,
      cents: acc.cents + r.cents,
    }),
    { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cents: 0 },
  )
}

/** Local `YYYY-MM-DD` key for an epoch-ms instant. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Roll records up to a dense per-day series across the WHOLE window, so the chart
 * shows zero-days (no gaps) and is comparable across ranges. Ascending by day.
 */
export function dailySeries(records: UsageRecord[], range: RangeKey, now: number): DayBucket[] {
  const days = RANGE_DAYS[range]
  // Seed every day in the window with zeros so empty days render honestly.
  const buckets = new Map<string, DayBucket>()
  const dayMs = 24 * 60 * 60 * 1000
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(now - i * dayMs)
    buckets.set(k, { day: k, requests: 0, tokens: 0, cents: 0 })
  }
  for (const r of records) {
    if (r.at === null) continue
    const k = dayKey(r.at)
    const b = buckets.get(k)
    if (!b) continue
    b.requests += 1
    b.tokens += r.totalTokens
    b.cents += r.cents
  }
  return Array.from(buckets.values())
}

/** Roll records up per model, sorted by spend (desc), then requests (desc). */
export function perModel(records: UsageRecord[]): ModelUsage[] {
  const by = new Map<string, ModelUsage>()
  for (const r of records) {
    const key = r.model || 'unknown'
    const cur =
      by.get(key) ??
      { model: r.model, provider: r.provider, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cents: 0 }
    cur.requests += 1
    cur.promptTokens += r.promptTokens
    cur.completionTokens += r.completionTokens
    cur.totalTokens += r.totalTokens
    cur.cents += r.cents
    if (!cur.provider && r.provider) cur.provider = r.provider
    by.set(key, cur)
  }
  return Array.from(by.values()).sort((a, b) => b.cents - a.cents || b.requests - a.requests)
}

/** The most recent `n` records (newest first). Undated records sort last. */
export function recent(records: UsageRecord[], n: number): UsageRecord[] {
  return [...records]
    .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity))
    .slice(0, n)
}

/** Fetch the org's raw usage records through the per-tenant `/billing/usage` proxy. */
export async function fetchUsageRecords(): Promise<UsageRecord[]> {
  return restGet<unknown>(billingUrl('usage')).then(normalizeUsageRecords)
}

/** Fetch the org's cloud-credit balance (USD cents) through the same proxy. */
export async function fetchBalance(currency = 'usd'): Promise<CloudBalance> {
  return restGet<CloudBalance>(`${billingUrl('balance')}?currency=${encodeURIComponent(currency)}`)
}

export { ApiError }
