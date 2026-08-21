/**
 * Admin operator-cockpit API — the fleet CUSTOMER management, REVENUE, ANALYTICS,
 * and ENABLEMENT surfaces. GLOBAL-ADMIN only.
 *
 * The customer/revenue/analytics reads + the credit/suspend mutations hit the cloud
 * `/v1/admin/*` surface (casibase `{status,msg,data}` envelope) through `originGet`/
 * `originPost` — same-origin, so they terminate at the GLOBAL-ADMIN-GATED
 * `app/admin/aggregate` proxy (`getAdminGate`, fail-closed 403, then a minted user
 * bearer). Pinning the ORIGIN (not `config.cloudUrl`) means a split-origin
 * `NEXT_PUBLIC_CLOUD_URL` can never route around the console gate.
 *
 * The enablement registry (cloud clients/pricing) returns PLAIN JSON, not the
 * casibase envelope, so it uses a small raw-JSON fetch. The ADMIN set/list ride the
 * same admin-aggregate gate (`/v1/admin/pricing/enablement`); the USER self-service
 * view + opt-in ride the per-tenant `/v1` proxy (`/v1/pricing/enablement`), which
 * scopes to the caller's own org — a customer can never flip global state.
 *
 * OPTIONAL-SAFE end to end: every field degrades to an honest 0 / empty / em-dash;
 * NOTHING is fabricated. Money is USD cents.
 */
import { ApiError, originGet, originPost } from './client'

// ── money view-models ────────────────────────────────────────────────────────

export type CustomerRow = {
  org: string
  display: string
  ownerEmail: string
  plan: string
  status: 'active' | 'suspended' | string
  users: number
  balanceCents: number
  spendCents: number
  mrrCents: number
  created: string
  lastActive: string
}

export type CustomerUser = {
  name: string
  email: string
  isAdmin: boolean
  forbidden: boolean
  hasApiKey: boolean
  lastSignin: string
  created: string
}

export type CustomerTxn = {
  id: string
  type: string
  cents: number
  currency: string
  notes?: string
  time: string
}

export type CustomerDetail = {
  org: string
  display: string
  ownerEmail: string
  plan: string
  status: string
  created: string
  balanceCents: number
  spendCents: number
  mrrCents: number
  apiKeys: number
  users: CustomerUser[]
  transactions: CustomerTxn[]
}

/** Where a staff grant lands: `trial` = non-cash comp credit (welcome/starter/comp),
 *  `prepaid` = real money. Spend draws trial-first (enforced server-side). */
export type GrantSource = 'trial' | 'prepaid'

export type GrantResult = { org: string; grantedCents: number; currency: string; balanceCents: number; transactionId: string }
export type SuspendResult = { org: string; suspended: boolean; affected: string[]; failed: string[] }

export type RevenueCustomer = { org: string; display: string; plan: string; balanceCents: number; spendCents: number; mrrCents: number }
export type SeriesPoint = { t: string; value: number }
export type RevenueData = {
  totalBalancesCents: number
  totalSpendCents: number
  mrrCents: number
  customers: number
  payingCustomers: number
  arpuCents: number
  perCustomer: RevenueCustomer[]
  spendTrend: SeriesPoint[]
  generatedAt: string
}

export type RetentionCohort = { cohort: string; size: number; values: number[] }
export type AnalyticsData = {
  range: string
  interval: string
  generatedAt: string
  signups: SeriesPoint[]
  cumulativeCustomers: SeriesPoint[]
  totalCustomers: number
  newCustomers: number
  growthRatePct: number
  activeCustomers: SeriesPoint[]
  dau: number
  wau: number
  mau: number
  retention: { interval: string; periods: number; cohorts: RetentionCohort[] }
  churn: SeriesPoint[]
  churnRatePct: number
  mrrCents: number
  revenue: SeriesPoint[]
  arpuCents: number
  ltvCents: number | null
  nrrPct: number | null
  usage: SeriesPoint[]
  topCustomers: { label: string; value: number; hint?: string }[]
  computed: Record<string, boolean>
}

// ── normalizers (optional-safe; never fabricate) ─────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const series = (v: unknown): SeriesPoint[] => arr(v).map((p) => {
  const r = (p ?? {}) as Record<string, unknown>
  return { t: str(r.t), value: num(r.value) }
})

function normalizeCustomer(raw: unknown): CustomerRow {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    org: str(r.org), display: str(r.display) || str(r.org), ownerEmail: str(r.ownerEmail),
    plan: str(r.plan) || 'pay-as-you-go', status: str(r.status) || 'active', users: num(r.users),
    balanceCents: num(r.balanceCents), spendCents: num(r.spendCents), mrrCents: num(r.mrrCents),
    created: str(r.created), lastActive: str(r.lastActive),
  }
}

function normalizeDetail(raw: unknown): CustomerDetail {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    org: str(r.org), display: str(r.display) || str(r.org), ownerEmail: str(r.ownerEmail),
    plan: str(r.plan) || 'pay-as-you-go', status: str(r.status) || 'active', created: str(r.created),
    balanceCents: num(r.balanceCents), spendCents: num(r.spendCents), mrrCents: num(r.mrrCents), apiKeys: num(r.apiKeys),
    users: arr(r.users).map((u) => {
      const ur = (u ?? {}) as Record<string, unknown>
      return { name: str(ur.name), email: str(ur.email), isAdmin: bool(ur.isAdmin), forbidden: bool(ur.forbidden), hasApiKey: bool(ur.hasApiKey), lastSignin: str(ur.lastSignin), created: str(ur.created) }
    }),
    transactions: arr(r.transactions).map((t) => {
      const tr = (t ?? {}) as Record<string, unknown>
      return { id: str(tr.id), type: str(tr.type), cents: num(tr.cents), currency: str(tr.currency) || 'usd', notes: str(tr.notes) || undefined, time: str(tr.time) }
    }),
  }
}

function normalizeRevenue(raw: unknown): RevenueData {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    totalBalancesCents: num(r.totalBalancesCents), totalSpendCents: num(r.totalSpendCents), mrrCents: num(r.mrrCents),
    customers: num(r.customers), payingCustomers: num(r.payingCustomers), arpuCents: num(r.arpuCents),
    perCustomer: arr(r.perCustomer).map((c) => {
      const cr = (c ?? {}) as Record<string, unknown>
      return { org: str(cr.org), display: str(cr.display) || str(cr.org), plan: str(cr.plan) || 'pay-as-you-go', balanceCents: num(cr.balanceCents), spendCents: num(cr.spendCents), mrrCents: num(cr.mrrCents) }
    }),
    spendTrend: series(r.spendTrend), generatedAt: str(r.generatedAt),
  }
}

function normalizeAnalytics(raw: unknown): AnalyticsData {
  const r = (raw ?? {}) as Record<string, unknown>
  const ret = (r.retention ?? {}) as Record<string, unknown>
  const computedRaw = (r.computed ?? {}) as Record<string, unknown>
  const computed: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(computedRaw)) computed[k] = v === true
  return {
    range: str(r.range) || '30d', interval: str(r.interval) || 'day', generatedAt: str(r.generatedAt),
    signups: series(r.signups), cumulativeCustomers: series(r.cumulativeCustomers),
    totalCustomers: num(r.totalCustomers), newCustomers: num(r.newCustomers), growthRatePct: num(r.growthRatePct),
    activeCustomers: series(r.activeCustomers), dau: num(r.dau), wau: num(r.wau), mau: num(r.mau),
    retention: {
      interval: str(ret.interval) || 'month', periods: num(ret.periods),
      cohorts: arr(ret.cohorts).map((c) => {
        const cr = (c ?? {}) as Record<string, unknown>
        return { cohort: str(cr.cohort), size: num(cr.size), values: arr(cr.values).map(num) }
      }),
    },
    churn: series(r.churn), churnRatePct: num(r.churnRatePct),
    mrrCents: num(r.mrrCents), revenue: series(r.revenue), arpuCents: num(r.arpuCents),
    ltvCents: typeof r.ltvCents === 'number' ? r.ltvCents : null,
    nrrPct: typeof r.nrrPct === 'number' ? r.nrrPct : null,
    usage: series(r.usage),
    topCustomers: arr(r.topCustomers).map((s) => {
      const sr = (s ?? {}) as Record<string, unknown>
      return { label: str(sr.label), value: num(sr.value), hint: str(sr.hint) || undefined }
    }),
    computed,
  }
}

// ── AdminCockpitApi (casibase envelope via the admin aggregate) ──────────────

export const AdminCockpitApi = {
  customers: async (): Promise<CustomerRow[]> => {
    const data = await originGet<unknown>('admin/customers')
    return arr(data).map(normalizeCustomer)
  },
  customer: async (org: string): Promise<CustomerDetail> =>
    normalizeDetail(await originGet<unknown>(`admin/customers/${encodeURIComponent(org)}`)),
  grantCredit: async (org: string, body: { amountCents: number; currency?: string; reason?: string; source?: GrantSource }, idempotencyKey?: string): Promise<GrantResult> => {
    // A grant is a real commerce deposit — NON-idempotent by nature. When the caller
    // supplies a stable-per-attempt key, the cloud reads `Idempotency-Key` and derives its
    // commerce dedupe key from it, so an operator retry after a network timeout collapses to
    // the ONE deposit instead of double-crediting. Body is unchanged.
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
    const d = (await originPost<unknown>(`admin/customers/${encodeURIComponent(org)}/credit`, body, undefined, headers) ?? {}) as Record<string, unknown>
    return { org: str(d.org) || org, grantedCents: num(d.grantedCents), currency: str(d.currency) || 'usd', balanceCents: num(d.balanceCents), transactionId: str(d.transactionId) }
  },
  suspend: async (org: string): Promise<SuspendResult> => suspendResult(await originPost<unknown>(`admin/customers/${encodeURIComponent(org)}/suspend`, {}), org),
  reactivate: async (org: string): Promise<SuspendResult> => suspendResult(await originPost<unknown>(`admin/customers/${encodeURIComponent(org)}/reactivate`, {}), org),
  revenue: async (): Promise<RevenueData> => normalizeRevenue(await originGet<unknown>('admin/revenue')),
  analytics: async (range: '7d' | '30d' | '90d' | 'all' = '30d'): Promise<AnalyticsData> =>
    normalizeAnalytics(await originGet<unknown>('admin/analytics', { range })),
}

function suspendResult(raw: unknown, org: string): SuspendResult {
  const d = (raw ?? {}) as Record<string, unknown>
  return { org: str(d.org) || org, suspended: bool(d.suspended), affected: arr(d.affected).map(str), failed: arr(d.failed).map(str) }
}

// ── Enablement (plain JSON; admin aggregate + /v1 user proxy) ─────────────

export type EnablementState = 'off' | 'beta' | 'ga'
export type AdminEnablementItem = { kind: string; id: string; state: EnablementState; betaOrgs: string[]; updatedAt: number }
export type UserEnablementItem = { kind: string; id: string; state: EnablementState; effective: boolean; optedIn: boolean; canOptIn: boolean }

/** Raw same-origin JSON fetch (enablement speaks plain JSON, not the casibase envelope). */
async function enablementReq<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
  }
  if (res.status === 403) throw new ApiError('forbidden', 403)
  if (res.status === 401) throw new ApiError('unauthorized', 401)
  const text = await res.text()
  let json: unknown
  if (text) {
    try { json = JSON.parse(text) } catch { if (!res.ok) throw new ApiError(`Request failed (HTTP ${res.status})`, res.status) }
  }
  if (!res.ok) {
    const m = json && typeof json === 'object' && typeof (json as { error?: unknown; msg?: unknown }).error === 'string'
      ? (json as { error: string }).error
      : `Request failed (HTTP ${res.status})`
    throw new ApiError(m, res.status)
  }
  return json as T
}

const asState = (v: unknown): EnablementState => (v === 'off' || v === 'beta' || v === 'ga' ? v : 'ga')

export const EnablementApi = {
  /** GLOBAL-admin: the managed registry (kind/id/state/grants). */
  list: async (): Promise<AdminEnablementItem[]> => {
    const d = await enablementReq<{ items?: unknown[] }>('GET', '/v1/admin/pricing/enablement')
    return arr(d?.items).map((i) => {
      const r = (i ?? {}) as Record<string, unknown>
      return { kind: str(r.kind), id: str(r.id), state: asState(r.state), betaOrgs: arr(r.betaOrgs).map(str), updatedAt: num(r.updatedAt) }
    })
  },
  /** GLOBAL-admin: set an item off|beta|ga (+optional grant list). */
  set: (body: { kind: string; id: string; state: EnablementState; betaOrgs?: string[] }): Promise<AdminEnablementItem> =>
    enablementReq<AdminEnablementItem>('PUT', '/v1/admin/pricing/enablement', body),
  /** Any authed user: their effective view + betas to opt into. */
  view: async (): Promise<{ org: string; items: UserEnablementItem[]; betas: UserEnablementItem[] }> => {
    const d = await enablementReq<{ org?: string; items?: unknown[]; betas?: unknown[] }>('GET', '/v1/pricing/enablement')
    const map = (v: unknown): UserEnablementItem => {
      const r = (v ?? {}) as Record<string, unknown>
      return { kind: str(r.kind), id: str(r.id), state: asState(r.state), effective: bool(r.effective), optedIn: bool(r.optedIn), canOptIn: bool(r.canOptIn) }
    }
    return { org: str(d?.org), items: arr(d?.items).map(map), betas: arr(d?.betas).map(map) }
  },
  /** User self-service: opt the caller's OWN org into / out of a beta item. */
  optIn: (body: { kind: string; id: string }): Promise<UserEnablementItem> => enablementReq<UserEnablementItem>('POST', '/v1/pricing/enablement/optin', body),
  optOut: (body: { kind: string; id: string }): Promise<UserEnablementItem> => enablementReq<UserEnablementItem>('POST', '/v1/pricing/enablement/optout', body),
}
