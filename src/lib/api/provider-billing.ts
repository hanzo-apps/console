/**
 * Admin provider BILLING API — the platform-wide credit + funding lens for the
 * shared-gateway upstream AI providers. GLOBAL-ADMIN only (admin.hanzo.ai).
 *
 * The economic sibling of `provider-admin.ts` (which flips the routing State/
 * IsDefault): this one answers "how much OUR-CREDIT vs PAID is each provider
 * burning, what's the runway, and how does spend split across credit / paid /
 * paid-only / BYO". Two reads on the same `/v1/admin/*` surface the aggregate
 * proxy already gates:
 *   - `GET /v1/admin/providers/credit` → per-provider grant / burn / remaining /
 *     runway_days / has_credit / is_paid_only.
 *   - `GET /v1/admin/usage/funding?from&to` → rows of {provider, model, funding,
 *     tokens, cost_cents, requests}, funding ∈ {credit, paid, paid_only, byo}.
 *
 * Both are `/v1/admin/{providers,usage}/...` — the `providers` and `usage` heads
 * are ALREADY allow-listed in `admin-aggregate.ts` (`allowAdminSurface` admits
 * `v1/admin/<head>/...`) and rewritten in `next.config.mjs`, so no proxy change is
 * needed; the request rides the SAME global-admin-gated `app/admin/aggregate` BFF
 * (`getAdminGate`, fail-closed 403, then a minted user bearer) as every other admin
 * read, and — in the go:embed console — hits cloud's `/v1/admin/*` directly under
 * the first-party session cookie. We pin the console's OWN origin (`originV1Url`),
 * never `config.cloudUrl`, so a split-origin override can't route around the gate.
 *
 * TRANSPORT is `restGet` (raw JSON) with a tolerant list extractor, so the client
 * works whether cloud returns the bare `[...]` the contract documents OR wraps it in
 * the casibase `{status,msg,data}` / `{usage:[...]}` envelope its sibling admin
 * routes use — one code path, honest `[]` on anything unexpected. Money is USD cents
 * end to end; NOTHING is fabricated (every field degrades to 0 / '' / null / em-dash).
 */
import { restGet, originV1Url } from './client'
import { rangeStart, type RangeKey } from './aimetrics'
import { RAMP, OTHER } from '~/lib/theme/ramp'

// ── view-models (the contract, camelCased) ───────────────────────────────────

/** One provider's credit position (`GET /v1/admin/providers/credit`). */
export type ProviderCredit = {
  /** Upstream provider key (e.g. `do-ai`, `openrouter`, `openai-direct`). */
  provider: string
  /** Total credit granted to us on this provider, USD cents. */
  grantCents: number
  /** Burn RATE against the credit, USD cents per day (pairs with `runwayDays`). */
  burnCents: number
  /** Remaining credit balance, USD cents. */
  remainingCents: number
  /** Days of runway at the current burn; `null` when N/A (no burn / not reported). */
  runwayDays: number | null
  /** We hold usable credit on this provider. */
  hasCredit: boolean
  /** This provider has no credit — usage is paid directly (paid-only). */
  isPaidOnly: boolean
}

/** How a unit of spend was funded (`funding` in the usage-funding contract). */
export type FundingClass = 'credit' | 'paid' | 'paid_only' | 'byo'

/** One row of funding-split usage (`GET /v1/admin/usage/funding`). */
export type FundingRow = {
  provider: string
  model: string
  /** Funding class, lower-cased. One of `FundingClass` for the known set; any
   *  other string still folds into its own bucket (honest, never dropped). */
  funding: string
  tokens: number
  costCents: number
  requests: number
}

// ── defensive scalars ────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
/** Read a finite number from either the snake_case or camelCase key, else `null`. */
const numOrNull = (...vs: unknown[]): number | null => {
  for (const v of vs) if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}
/** First present string across alternative keys (snake/camel tolerance). */
const pick = (...vs: unknown[]): string => {
  for (const v of vs) if (typeof v === 'string' && v) return v
  return ''
}
/** First present finite number across alternative keys (snake/camel tolerance). */
const pickNum = (...vs: unknown[]): number => {
  for (const v of vs) if (typeof v === 'number' && Number.isFinite(v)) return v
  return 0
}

/**
 * Extract the row array from whatever shape the backend returns: the bare `[...]`
 * the contract documents, the casibase `{status,msg,data:[...]}` envelope its
 * sibling admin routes use, or a named wrapper (`{usage|rows|providers|credits|
 * funding:[...]}`). Anything else → `[]` (honest empty, never a throw).
 */
export function pluckList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    for (const k of ['data', 'usage', 'rows', 'providers', 'credits', 'funding', 'items', 'results']) {
      if (Array.isArray(r[k])) return r[k] as unknown[]
    }
  }
  return []
}

export function normalizeCredit(raw: unknown): ProviderCredit {
  const r = (raw ?? {}) as Record<string, unknown>
  const grantCents = pickNum(r.grant_cents, r.grantCents)
  const remainingCents = pickNum(r.remaining_cents, r.remainingCents)
  const burnCents = pickNum(r.burn_cents, r.burnCents)
  // has_credit defaults to "there is a positive remaining balance" when the flag
  // is absent — honest derivation, never fabricated.
  const hasCreditRaw = r.has_credit ?? r.hasCredit
  return {
    provider: pick(r.provider, r.name, r.id),
    grantCents,
    burnCents,
    remainingCents,
    runwayDays: numOrNull(r.runway_days, r.runwayDays),
    hasCredit: typeof hasCreditRaw === 'boolean' ? hasCreditRaw : remainingCents > 0,
    isPaidOnly: bool(r.is_paid_only ?? r.isPaidOnly),
  }
}

export function normalizeFunding(raw: unknown): FundingRow {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    provider: pick(r.provider, r.name),
    model: pick(r.model, r.model_id, r.modelId),
    funding: pick(r.funding, r.funding_class, r.fundingClass).toLowerCase(),
    tokens: pickNum(r.tokens, r.total_tokens, r.totalTokens),
    costCents: pickNum(r.cost_cents, r.costCents),
    requests: pickNum(r.requests, r.request_count, r.requestCount),
  }
}

// ── funding-class metadata (labels + colors, one source) ─────────────────────

/** The four known funding classes, in display order. */
export const FUNDING_ORDER: FundingClass[] = ['credit', 'paid', 'paid_only', 'byo']

/**
 * Label + chart color + one-line meaning for each known funding class.
 *
 * The console chrome is monochrome, so these four categories are separated by
 * LIGHTNESS, not hue — every other step of the shared categorical scale
 * (`lib/theme/ramp`), so no two adjacent classes read alike. Order is display order:
 * the class we most want to see first reads brightest.
 */
export const FUNDING_META: Record<FundingClass, { label: string; color: string; hint: string }> = {
  credit: { label: 'Our credit', color: RAMP[0], hint: 'Drawn from provider credit we hold (free to us).' },
  paid: { label: 'Paid', color: RAMP[2], hint: 'Hanzo pays the provider for this usage.' },
  paid_only: { label: 'Paid-only', color: RAMP[4], hint: 'Provider with no credit — billed directly.' },
  byo: { label: 'BYO key', color: RAMP[6], hint: "Served on a customer's own provider key." },
}

/** Label for a funding value (known → its label; unknown → the raw value). */
export const fundingLabel = (f: string): string => FUNDING_META[f as FundingClass]?.label ?? (f || 'Other')
/** Chart color for a funding value (known → its color; unknown → neutral). */
export const fundingColor = (f: string): string => FUNDING_META[f as FundingClass]?.color ?? OTHER

// ── roll-ups (pure) ──────────────────────────────────────────────────────────

/** Aggregate credit position across all providers — the headline band. */
export type CreditSummary = {
  totalGrantCents: number
  totalRemainingCents: number
  totalBurnCents: number
  /** Least runway across providers that hold credit — the "we run out first" signal. */
  minRunwayDays: number | null
  providersWithCredit: number
  providers: number
}

export function creditSummary(credits: ProviderCredit[]): CreditSummary {
  const withCredit = credits.filter((c) => c.hasCredit)
  const runways = withCredit.map((c) => c.runwayDays).filter((d): d is number => d !== null)
  return {
    totalGrantCents: credits.reduce((s, c) => s + c.grantCents, 0),
    totalRemainingCents: credits.reduce((s, c) => s + c.remainingCents, 0),
    totalBurnCents: credits.reduce((s, c) => s + c.burnCents, 0),
    minRunwayDays: runways.length ? Math.min(...runways) : null,
    providersWithCredit: withCredit.length,
    providers: credits.length,
  }
}

/** Totals for one funding class over the window. */
export type FundingBucket = { tokens: number; costCents: number; requests: number }

/** The whole funding split: per-class buckets, grand total, and ordered cost slices. */
export type FundingFold = {
  byClass: Record<string, FundingBucket>
  total: FundingBucket
  /** Ordered {label,value(costCents),color,hint} for a cost-by-funding donut. */
  costSlices: { label: string; value: number; color: string; hint: string }[]
}

const emptyBucket = (): FundingBucket => ({ tokens: 0, costCents: 0, requests: 0 })

/**
 * Fold funding rows into per-class buckets + grand total + ordered cost slices.
 * Known classes come first in `FUNDING_ORDER`; any unknown funding string keeps its
 * own bucket (sorted after, by cost) so nothing is silently merged or dropped.
 */
export function foldFunding(rows: FundingRow[]): FundingFold {
  const byClass: Record<string, FundingBucket> = {}
  const total = emptyBucket()
  for (const r of rows) {
    const b = (byClass[r.funding] ??= emptyBucket())
    b.tokens += r.tokens
    b.costCents += r.costCents
    b.requests += r.requests
    total.tokens += r.tokens
    total.costCents += r.costCents
    total.requests += r.requests
  }
  const known = FUNDING_ORDER.filter((f) => byClass[f])
  const unknown = Object.keys(byClass)
    .filter((k) => !FUNDING_ORDER.includes(k as FundingClass))
    .sort((a, b) => byClass[b].costCents - byClass[a].costCents)
  const costSlices = [...known, ...unknown].map((f) => ({
    label: fundingLabel(f),
    value: byClass[f].costCents,
    color: fundingColor(f),
    hint: FUNDING_META[f as FundingClass]?.hint ?? '',
  }))
  return { byClass, total, costSlices }
}

// ── formatting (pure) ─────────────────────────────────────────────────────────

/** USD cents → `$1,234.56` (tabular-nums applied at the render site). */
export const usd = (cents: number | null | undefined): string =>
  cents == null ? '—' : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Compact a large count (tokens/requests) — `1.2M`, `3.4K`, `842`. */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

/** Human runway from `runway_days`: `—` (N/A), `∞` (>~5y / no burn), `< 1 day`, `N days`. */
export function runwayLabel(days: number | null): string {
  if (days == null) return '—'
  if (days >= 1825 || !Number.isFinite(days)) return '∞'
  if (days < 1) return '< 1 day'
  const d = Math.round(days)
  return `${d.toLocaleString('en-US')} ${d === 1 ? 'day' : 'days'}`
}

/** Tone for a runway value: red under 2 weeks, amber under 6 weeks, else calm. */
export function runwayTone(days: number | null): 'ok' | 'warn' | 'crit' {
  if (days == null) return 'ok'
  if (days < 14) return 'crit'
  if (days < 42) return 'warn'
  return 'ok'
}

/** The credit badge for a provider card. */
export function creditBadge(c: ProviderCredit): { label: string; tone: 'credit' | 'paid' | 'empty' } {
  if (c.isPaidOnly && !c.hasCredit) return { label: 'Paid-only', tone: 'paid' }
  if (c.hasCredit) return { label: 'Has credit', tone: 'credit' }
  return { label: 'Depleted', tone: 'empty' }
}

/**
 * The `?from&to` window for a range — RFC3339 (UTC) bounds, reusing the shared
 * `rangeStart` so the funding window is the same grammar as every other console
 * spend view. (Backend expects ISO timestamps; flagged if it wants epoch/date-only.)
 */
export function fundingWindow(range: RangeKey, now: number = Date.now()): { from: string; to: string } {
  return { from: new Date(rangeStart(range, now)).toISOString(), to: new Date(now).toISOString() }
}

// ── API ────────────────────────────────────────────────────────────────────

export const ProviderBillingApi = {
  /** Per-provider credit position. Throws a typed `ApiError` (403 → operator gate,
   *  404 → not routed yet) the caller renders as an honest state. */
  credit: async (): Promise<ProviderCredit[]> =>
    pluckList(await restGet<unknown>(originV1Url('admin/providers/credit'))).map(normalizeCredit),

  /** Credit-vs-paid usage split over a window. */
  funding: async (range: RangeKey, now: number = Date.now()): Promise<FundingRow[]> => {
    const { from, to } = fundingWindow(range, now)
    const url = `${originV1Url('admin/usage/funding')}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    return pluckList(await restGet<unknown>(url)).map(normalizeFunding)
  },
}
