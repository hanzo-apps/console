/**
 * Admin (GLOBAL) SaaS operations — the whole-business revenue / subscription /
 * customer snapshot behind the admin.hanzo.ai "SaaS Metrics" board. It is computed
 * IN commerce (the system of record for subscriptions + the usage ledger) from ONE
 * cross-org walk and served at `GET /v1/commerce/metrics/saas`; the console only
 * renders it — no client-side billing SDK, no re-aggregation.
 *
 * Transport: `originGet('admin/saas', …)` pins the request to the console's OWN
 * origin, terminating at the global-admin-gated `app/admin/saas` proxy, which runs
 * `getAdminGate` (fail-closed 403 for a non-global-admin) BEFORE forwarding to
 * commerce with the service token. So the cross-tenant aggregate is server-gated end
 * to end; a customer can never read it.
 *
 * Per-model LLM tokens/latency/error and the per-org AI-spend ranking are NOT here —
 * that is the fleet o11y god-view (`AdminO11yApi`, `/v1/admin/o11y`); the SaaS board
 * composes both so there is ONE per-model aggregate, never a fork.
 *
 * Honest by construction: every field is defensively normalized (missing → 0 / [],
 * snake_case AND camelCase tolerated), and `upgrades`/`downgrades` stay `null` when
 * not instrumented — so a partial backend renders real zeros / honest "—", never a
 * fabricated MRR.
 */
import { originGet } from './client'

export type SaasWindow = '7d' | '30d' | '90d' | 'mtd' | 'all'

export type CategoryMRR = { category: string; mrrCents: number; subscriptions: number }

export type RevenueMetrics = {
  mrrCents: number
  arrCents: number
  activeSubscriptions: number
  payingCustomers: number
  trials: number
  newMrrCents: number
  churnedMrrCents: number
  netNewMrrCents: number
  byCategory: CategoryMRR[]
}

export type PlanBreakdown = {
  plan: string
  name: string
  category: string
  active: number
  trialing: number
  seats: number
  mrrCents: number
}

export type SubEvent = {
  at: string
  org: string
  type: string
  plan: string
  category: string
  mrrDeltaCents: number
}

export type SubscriptionMetrics = {
  byPlan: PlanBreakdown[]
  trialsActive: number
  new: number
  canceled: number
  upgrades: number | null
  downgrades: number | null
  recent: SubEvent[]
}

export type UsageMetrics = {
  instrumented: boolean
  windowUsageCents: number
  requests: number
  untaggedRequests: number
}

export type CustomerRow = {
  org: string
  plan: string
  category: string
  status: string
  mrrCents: number
  usageCents: number
  seats: number
  since: string
}

export type SaaSMetrics = {
  asOf: string
  currency: string
  window: string
  revenue: RevenueMetrics
  subscriptions: SubscriptionMetrics
  usage: UsageMetrics
  customers: CustomerRow[]
  orgs: number
  gaps: string[]
}

// ── defensive coercion (snake_case OR camelCase; missing/garbage → honest zero) ──
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
/** A nullable integer that PRESERVES null (a not-instrumented signal, never 0). */
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))
const g = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

const normCategory = (v: unknown): CategoryMRR[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return { category: str(g(o, 'category')), mrrCents: num(g(o, 'mrrCents', 'mrr_cents')), subscriptions: num(g(o, 'subscriptions')) }
  })

const normRevenue = (v: unknown): RevenueMetrics => {
  const o = rec(v)
  return {
    mrrCents: num(g(o, 'mrrCents', 'mrr_cents')),
    arrCents: num(g(o, 'arrCents', 'arr_cents')),
    activeSubscriptions: num(g(o, 'activeSubscriptions', 'active_subscriptions')),
    payingCustomers: num(g(o, 'payingCustomers', 'paying_customers')),
    trials: num(g(o, 'trials')),
    newMrrCents: num(g(o, 'newMrrCents', 'new_mrr_cents')),
    churnedMrrCents: num(g(o, 'churnedMrrCents', 'churned_mrr_cents')),
    netNewMrrCents: num(g(o, 'netNewMrrCents', 'net_new_mrr_cents')),
    byCategory: normCategory(g(o, 'byCategory', 'by_category')),
  }
}

const normPlans = (v: unknown): PlanBreakdown[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return {
      plan: str(g(o, 'plan')),
      name: str(g(o, 'name')),
      category: str(g(o, 'category')),
      active: num(g(o, 'active')),
      trialing: num(g(o, 'trialing')),
      seats: num(g(o, 'seats')),
      mrrCents: num(g(o, 'mrrCents', 'mrr_cents')),
    }
  })

const normEvents = (v: unknown): SubEvent[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return {
      at: str(g(o, 'at')),
      org: str(g(o, 'org')),
      type: str(g(o, 'type')),
      plan: str(g(o, 'plan')),
      category: str(g(o, 'category')),
      mrrDeltaCents: num(g(o, 'mrrDeltaCents', 'mrr_delta_cents')),
    }
  })

const normSubs = (v: unknown): SubscriptionMetrics => {
  const o = rec(v)
  return {
    byPlan: normPlans(g(o, 'byPlan', 'by_plan')),
    trialsActive: num(g(o, 'trialsActive', 'trials_active')),
    new: num(g(o, 'new')),
    canceled: num(g(o, 'canceled')),
    upgrades: numOrNull(g(o, 'upgrades')),
    downgrades: numOrNull(g(o, 'downgrades')),
    recent: normEvents(g(o, 'recent')),
  }
}

const normUsage = (v: unknown): UsageMetrics => {
  const o = rec(v)
  return {
    instrumented: bool(g(o, 'instrumented')),
    windowUsageCents: num(g(o, 'windowUsageCents', 'window_usage_cents')),
    requests: num(g(o, 'requests')),
    untaggedRequests: num(g(o, 'untaggedRequests', 'untagged_requests')),
  }
}

const normCustomers = (v: unknown): CustomerRow[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return {
      org: str(g(o, 'org')),
      plan: str(g(o, 'plan')),
      category: str(g(o, 'category')),
      status: str(g(o, 'status')),
      mrrCents: num(g(o, 'mrrCents', 'mrr_cents')),
      usageCents: num(g(o, 'usageCents', 'usage_cents')),
      seats: num(g(o, 'seats')),
      since: str(g(o, 'since')),
    }
  })

/** Normalize the raw `/v1/commerce/metrics/saas` payload into the typed board model. */
export function normalizeSaaS(raw: unknown): SaaSMetrics {
  const d = rec(raw)
  return {
    asOf: str(g(d, 'asOf', 'as_of')),
    currency: str(g(d, 'currency')) || 'usd',
    window: str(g(d, 'window')) || '30d',
    revenue: normRevenue(g(d, 'revenue')),
    subscriptions: normSubs(g(d, 'subscriptions')),
    usage: normUsage(g(d, 'usage')),
    customers: normCustomers(g(d, 'customers')),
    orgs: num(g(d, 'orgs')),
    gaps: arr(g(d, 'gaps')).map((x) => str(x)).filter(Boolean),
  }
}

export const SaasApi = {
  /**
   * The whole-business SaaS snapshot for a window. Throws a typed `ApiError` (403
   * for a non-global-admin, 501 when commerce isn't configured) that the board
   * renders as an honest state — never a fabricated business.
   */
  metrics: async (window: SaasWindow = '30d', limit = 20): Promise<SaaSMetrics> =>
    normalizeSaaS(await originGet<unknown>('admin/saas', { window, limit })),
}
