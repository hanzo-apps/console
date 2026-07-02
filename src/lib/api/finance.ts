/**
 * Finance API — the SaaS business/finance feed for admin.hanzo.ai.
 *
 * SOURCE: `GET /v1/admin/finance` (the cloud admin aggregate: DigitalOcean billing
 * for cost + commerce for revenue). Like every other admin read it goes through
 * `originGet` — the console's OWN origin (`<origin>/v1/admin/finance`), which
 * `next.config.mjs` rewrites to the GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy
 * (`getAdminGate`, fail-closed 403, THEN a minted user bearer). Financial data is
 * Hanzo-internal: a tenant customer (even an org-level admin) can NEVER reach it —
 * the console-side gate 403s before the request is forwarded, and pinning the ORIGIN
 * (not `config.cloudUrl`) means a split-origin `NEXT_PUBLIC_CLOUD_URL` can't bypass
 * it. The browser holds no admin credential.
 *
 * OPTIONAL-SAFE end to end: `normalizeFinance` maps whatever the endpoint returns
 * onto `Finance`, and every missing field degrades to an honest zero/empty/`null` —
 * a deployment with no `DO_API_TOKEN` (`cost.digitalocean.configured === false`), an
 * unreachable commerce, or a not-routed admin backend (`ApiError 404`) renders honest
 * "—"/"not connected", NEVER a fabricated MRR or margin. Money is USD cents end to end.
 */
import { originGet } from './client'

/** One point of the DO credit burn-down series (a billing-history charge/credit). */
export type FinanceHistoryPoint = {
  /** RFC3339 date of the entry. */
  date: string
  /** Signed USD cents (Invoice charges positive; Credit grants negative). */
  amountCents: number
  /** DO billing-history type (Invoice, Credit, Payment, …). */
  type: string
  description: string
}

/** The DigitalOcean cost view (our primary venue). All money in USD cents. */
export type FinanceDoCost = {
  /** False when `DO_API_TOKEN` is unset — every number is 0 and the board shows the honest connect state. */
  configured: boolean
  /** Honest error string when DO is unconfigured/unreachable; '' otherwise. */
  error: string
  /** Remaining promo credit (= -account_balance, clamped ≥ 0). */
  creditRemainingCents: number
  /** Spend in the current billing period. */
  monthToDateSpendCents: number
  /** Average daily burn (MTD spend / elapsed days). */
  avgDailyBurnCents: number
  /** DO account_balance (negative = credit held, positive = owed) — for reference. */
  accountBalanceCents: number
  /** When DO generated the balance. */
  generatedAt: string
  /** Credit burn-down series (empty when history is unavailable — honest empty chart). */
  history: FinanceHistoryPoint[]
}

/** The commerce revenue view. All money in USD cents. */
export type FinanceRevenue = {
  /** False when commerce is unreachable — every number is 0. */
  configured: boolean
  totalRevenueCents: number
  mrrCents: number
  creditsConsumedCents: number
}

/** The pure derived profitability. `runwayDays` is null when burn is 0 or DO is off. */
export type FinanceDerived = {
  grossMarginCents: number
  grossMarginPct: number
  runwayDays: number | null
  profitable: boolean
}

/** The whole finance aggregate in one payload. */
export type Finance = {
  cost: { digitalocean: FinanceDoCost }
  revenue: FinanceRevenue
  derived: FinanceDerived
  generatedAt: string
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function normalizeHistory(v: unknown): FinanceHistoryPoint[] {
  return arr(v).map((p) => {
    const r = obj(p)
    return { date: str(r.date), amountCents: num(r.amountCents), type: str(r.type), description: str(r.description) }
  })
}

function normalizeDoCost(v: unknown): FinanceDoCost {
  const r = obj(v)
  return {
    configured: bool(r.configured),
    error: str(r.error),
    creditRemainingCents: num(r.creditRemainingCents),
    monthToDateSpendCents: num(r.monthToDateSpendCents),
    avgDailyBurnCents: num(r.avgDailyBurnCents),
    accountBalanceCents: num(r.accountBalanceCents),
    generatedAt: str(r.generatedAt),
    history: normalizeHistory(r.history),
  }
}

function normalizeRevenue(v: unknown): FinanceRevenue {
  const r = obj(v)
  return {
    configured: bool(r.configured),
    totalRevenueCents: num(r.totalRevenueCents),
    mrrCents: num(r.mrrCents),
    creditsConsumedCents: num(r.creditsConsumedCents),
  }
}

function normalizeDerived(v: unknown): FinanceDerived {
  const r = obj(v)
  // runwayDays is honestly NULL when burn is 0 / DO unconfigured — preserve null,
  // never coerce to 0 (0 days would read as "out of runway", a fabricated alarm).
  const runway = typeof r.runwayDays === 'number' && Number.isFinite(r.runwayDays) ? r.runwayDays : null
  return {
    grossMarginCents: num(r.grossMarginCents),
    grossMarginPct: num(r.grossMarginPct),
    runwayDays: runway,
    profitable: bool(r.profitable),
  }
}

/** Map an arbitrary `/v1/admin/finance` payload onto `Finance` (optional-safe). */
export function normalizeFinance(raw: unknown): Finance {
  const r = obj(raw)
  return {
    cost: { digitalocean: normalizeDoCost(obj(r.cost).digitalocean) },
    revenue: normalizeRevenue(r.revenue),
    derived: normalizeDerived(r.derived),
    generatedAt: str(r.generatedAt),
  }
}

export const FinanceApi = {
  /**
   * The SaaS finance aggregate (DO cost + commerce revenue + derived margin/runway).
   * Throws a typed `ApiError` (404 when the admin backend isn't routed on this host,
   * 403 when the caller is not a global admin) that the loader renders as an honest
   * state. Always the all-orgs god view (revenue is fleet-wide).
   */
  finance: async (): Promise<Finance> => {
    const data = await originGet<unknown>('admin/finance', { org: 'all' })
    return normalizeFinance(data)
  },
}
