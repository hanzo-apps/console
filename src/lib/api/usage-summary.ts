/**
 * Typed client for the unified USAGE SUMMARY endpoint (cloud `clients/usage`),
 * called SAME-ORIGIN with NO prefix (`originV1Url('usage/summary')`). The
 * next.config rewrite terminates it at the console's `/v1` user-bearer proxy,
 * which mints a short-lived user Bearer and forwards to cloud-api; the org is
 * resolved server-authoritatively from the Bearer owner claim, so every figure is
 * scoped to the caller's OWN org — the browser never holds a billing credential.
 *
 * ONE endpoint — the org's cost roll-up (spend by category over time + wallet) plus
 * LLM usage totals, composed from the commerce ledger + the warehouse. Responses are
 * BARE JSON (the usage handler writes the struct directly — NOT the casibase
 * envelope), so this uses `restGet` and normalizes DEFENSIVELY (a field rename or an
 * absent source degrades to 0 / [] / available:false, never throws).
 *
 * Field names mirror the Go response structs in `clients/usage/query.go` exactly.
 */
import { restGet, originV1Url } from './client'

/** The window grammar the backend understands (ResolveCloudUsageWindow). */
export type UsageRange = '24h' | '7d' | '30d'

// ── Defensive coercion (a shape drift degrades, never throws) ────────────────
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arrayOf = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []

// ── Response types (mirror clients/usage/query.go) ───────────────────────────

/** One spend-by-category bucket (cents + how many ledger lines rolled up). */
export type CategorySpend = { category: string; cents: number; count: number }
/** One consumption time bucket (usage cents). */
export type SpendPoint = { t: string; cents: number }

/** The cost roll-up: windowed total + month-to-date + wallet + breakdowns. */
export type Spend = {
  available: boolean
  totalCents: number
  mtdCents: number
  overageCents: number
  balanceCents: number
  availableCents: number
  byCategory: CategorySpend[]
  series: SpendPoint[]
}

/** The LLM usage totals block (per-model detail lives at /v1/analytics/*). */
export type LlmTotals = {
  available: boolean
  requests: number
  tokens: number
  promptTokens: number
  completionTokens: number
  costCents: number
  models: number
}

/** Which upstreams actually answered (honest board badges). */
export type UsageSources = { commerce: boolean; warehouse: boolean }

export type UsageSummary = {
  range: string
  start: string
  end: string
  interval: string
  org: string
  spend: Spend
  llm: LlmTotals
  sources: UsageSources
}

// ── Normalizer (pure, exported for unit tests) ───────────────────────────────

export function normalizeSummary(raw: unknown): UsageSummary {
  const r = asRecord(raw)
  const spend = asRecord(r.spend)
  const llm = asRecord(r.llm)
  const sources = asRecord(r.sources)
  return {
    range: str(r.range),
    start: str(r.start),
    end: str(r.end),
    interval: str(r.interval),
    org: str(asRecord(r.scope).org),
    spend: {
      available: bool(spend.available),
      totalCents: num(spend.totalCents),
      mtdCents: num(spend.mtdCents),
      overageCents: num(spend.overageCents),
      balanceCents: num(spend.balanceCents),
      availableCents: num(spend.availableCents),
      byCategory: arrayOf(spend.byCategory).map((c) => ({
        category: str(c.category),
        cents: num(c.cents),
        count: num(c.count),
      })),
      series: arrayOf(spend.series).map((p) => ({ t: str(p.t), cents: num(p.cents) })),
    },
    llm: {
      available: bool(llm.available),
      requests: num(llm.requests),
      tokens: num(llm.tokens),
      promptTokens: num(llm.promptTokens),
      completionTokens: num(llm.completionTokens),
      costCents: num(llm.costCents),
      models: num(llm.models),
    },
    sources: { commerce: bool(sources.commerce), warehouse: bool(sources.warehouse) },
  }
}

const q = (range: UsageRange, opts?: { start?: string; end?: string }): string => {
  const sp = new URLSearchParams({ range })
  if (opts?.start) sp.set('start', opts.start)
  if (opts?.end) sp.set('end', opts.end)
  return originV1Url(`usage/summary?${sp.toString()}`)
}

/**
 * UsageSummaryApi — the ONE org-scoped footprint roll-up. A plain GET through the
 * same-origin `/v1` bearer proxy; the org is server-side. A 401/403 (session
 * lapse) surfaces to the caller's BackendStateCard.
 */
export const UsageSummaryApi = {
  summary: (range: UsageRange = '24h', opts?: { start?: string; end?: string }): Promise<UsageSummary> =>
    restGet<unknown>(q(range, opts)).then(normalizeSummary),
}
