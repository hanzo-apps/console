/**
 * Billing — the signed-in tenant's money surface (commerce, hanzoai/commerce):
 * credit balance, metered usage, invoices, subscriptions, and payment methods.
 *
 * Every call goes through the console's OWN same-origin `/v1/billing/*` server proxy
 * (`app/v1/billing/[...path]/route.ts`), which injects the commerce SERVICE token
 * server-side and scopes every request to the caller's OWN org/billing-subject —
 * the browser never holds a commerce credential and cannot widen scope. The
 * subject is the SAME one the gateway debits, so what the console shows is what
 * actually gets charged.
 *
 * Read-only here: WRITES (paying, adding/removing a payment method, changing a
 * subscription) stay in the brand billing portal (`config.billingUrl`), which the
 * pages link to — the console reads and displays, it does not mutate money state.
 * Shapes are intentionally permissive: commerce's payloads are
 * normalized defensively so a field rename upstream degrades a cell to "—" rather
 * than throwing, and card data is masked to brand + last4 (never a PAN/CVV/token).
 * On a 404/501/401 the caller renders the shared `BackendStateCard` — never
 * fabricated spend, balance, or card data.
 */
import { restGet, restPost, restPatch, restDelete, billingProxyV1Url } from './client'
import type { CloudBalance } from './wallet'
import { normalizeUsageRecords, perModel, totalsOf } from './aimetrics'

// Billing DATA calls build the canonical `/v1/billing/*` path (the /v1-first law: ZERO
// prefix before `/v1/`), one builder `billingProxyV1Url`. Standalone (console2/admin):
// `/v1/billing/*` resolves to the console's OWN `app/v1/billing/[...path]` route handler
// (MORE SPECIFIC than the `/v1/[...path]` cloud BFF), which injects the commerce service
// token + pins the caller's own subject. Embed (console.hanzo.ai): the same `/v1/billing/*`
// is served by the cloud binary under the first-party session cookie. Same scoping either way.

/** One metered line — spend grouped by product/model over the window. */
export type UsageLine = {
  /** Product or model the spend is attributed to. */
  label: string
  /** Requests / units in the window, if reported. */
  units?: number
  /** Tokens consumed, if reported. */
  tokens?: number
  /** Cost in USD cents. */
  cents: number
}

/** Usage over a window — total spend plus a per-product/model breakdown. */
export type Usage = {
  /** Total spend in the window, USD cents. */
  totalCents: number
  /** ISO window start, if reported. */
  start?: string
  /** ISO window end, if reported. */
  end?: string
  /** Per-product/model breakdown (may be empty if commerce reports a total only). */
  lines: UsageLine[]
}

/** One invoice in the tenant's billing history. */
export type Invoice = {
  id: string
  /** ISO issue date. */
  date?: string
  /** Invoice total, USD cents. */
  cents: number
  /** Commerce status — paid, open, void, etc. */
  status?: string
  /** Hosted invoice / receipt URL, if commerce provides one. */
  url?: string
}

/** One subscription the org holds (commerce `/v1/billing/subscriptions`). */
export type Subscription = {
  id: string
  /** Plan / product name (from the plan nickname or the first subscription item). */
  plan: string
  /** Commerce status — active, trialing, past_due, canceled, etc. */
  status?: string
  /** Seats / units, if the subscription reports a quantity. */
  quantity?: number
  /** Recurring price in USD cents, if reported. */
  cents?: number
  /** Billing interval — month, year, etc. */
  interval?: string
  /** ISO end of the current billing period (renewal date). */
  currentPeriodEnd?: string
  /** True when the subscription is set to cancel at the end of the current period
   *  (a scheduled cancel; still active until `currentPeriodEnd`, then it ends). */
  cancelAtPeriodEnd?: boolean
  /** ISO time the subscription was canceled, if it has been (immediate cancel). */
  canceledAt?: string
}

/**
 * One saved payment method (commerce `/v1/billing/methods`). Carries ONLY
 * the masked, non-sensitive descriptor commerce returns — brand + last4 + expiry.
 * A full PAN / CVV / gateway token is NEVER present in this shape and must never
 * be surfaced; a missing descriptor degrades to "—".
 */
export type PaymentMethod = {
  id: string
  /** Kind — card, bank_account, sepa_debit, etc. */
  type?: string
  /** Card network / brand (visa, mastercard, amex), when a card. */
  brand?: string
  /** Last four digits — the ONLY card number fragment commerce exposes. */
  last4?: string
  /** Expiry month (1–12), if a card. */
  expMonth?: number
  /** Expiry year (4-digit), if a card. */
  expYear?: number
  /** The org's default payment method. */
  isDefault?: boolean
}

/**
 * One spend alert / budget — a threshold (USD cents) that trips when the org's
 * spend crosses it (commerce `spendalert`). This is the ONE real budgets surface:
 * commerce serves `GET/POST /v1/billing/alerts` under the user group (the
 * same one billing.hanzo.ai calls), so the console reads + creates real budgets —
 * never a fake form. `triggeredAt` is set by commerce when the threshold trips.
 */
export type SpendAlert = {
  id: string
  /** Human name for the budget, e.g. "Monthly cap". */
  title: string
  /** The spend CAP for the period in USD cents; 0 = unlimited (alert/rate-limit only). */
  thresholdCents: number
  /** Ledger currency (lowercase ISO), e.g. `usd`. */
  currency: string
  /** ISO time the alert last tripped, or undefined if it never has. */
  triggeredAt?: string
  /** ISO creation time. */
  createdAt?: string
  // ── Scope + enforcement (the alerts extended fields) ──────────────────
  // Forward-compatible: a legacy soft-alert row that predates these lights up with
  // sensible defaults (org-wide, alert-only, softPct 80, no rate limit, zero spent)
  // and the meter/enforce/rate-limit surface activates the moment the backend emits
  // them — nothing is fabricated.
  /** '' = every project (the ORG-WIDE default when `service` is '' too). */
  project: string
  /** '' = every service within the project. */
  service: string
  /** true = HARD cap (billable calls get 402 once over); false = soft alert only. */
  enforce: boolean
  /** Soft-warn threshold as a percent of the cap (0–100). Backend default 80. */
  softPct: number
  /** Requests/minute ceiling; 0 = no limit (else 429 when exceeded). */
  rateLimitRpm: number
  /** Cents spent so far this period (backend-computed, READ-ONLY). */
  periodSpentCents: number
  /** True once spend has reached/crossed the cap (blocked when `enforce`). */
  over: boolean
  /** True once spend has crossed the soft-warn threshold. */
  warn: boolean
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1

/** Cents from a record that may report `cents`, or a dollar `amount`/`cost`/`total`. */
const centsOf = (r: Record<string, unknown>): number => {
  const c = num(r.cents) ?? num(r.amountCents) ?? num(r.costCents)
  if (c !== undefined) return Math.round(c)
  const dollars = num(r.amount) ?? num(r.cost) ?? num(r.total) ?? num(r.totalCost)
  return dollars !== undefined ? Math.round(dollars * 100) : 0
}

/** Pull the first array found under any of the common envelope keys. */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v as Record<string, unknown>[]
    }
  }
  return []
}

/**
 * True for the commerce api-usage ledger shape (`{ usage: [ { transactionId,
 * amount, metadata, createdAt } ] }`), as opposed to a pre-rolled summary. The
 * ledger carries per-request rows whose model lives in `metadata.model` and whose
 * `amount` is already in CENTS — flattening it with the generic root-key reader
 * mislabels every row "Usage" and multiplies the cost ×100 (cents read as
 * dollars). So we detect it and roll it up with the ONE shared parser.
 */
function isUsageLedger(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const v = (payload as Record<string, unknown>).usage
  if (!Array.isArray(v) || v.length === 0) return false
  const first = v[0]
  return Boolean(first && typeof first === 'object' && ('transactionId' in first || 'metadata' in first || 'createdAt' in first))
}

function normalizeUsage(payload: unknown): Usage {
  const root = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {})

  // The real commerce ledger: parse + roll up per model with the SAME functions
  // AI Metrics uses (DRY) — correct cents, real model names, real token sums.
  if (isUsageLedger(payload)) {
    const records = normalizeUsageRecords(payload)
    const lines = perModel(records).map((m) => ({
      label: m.model || 'API usage',
      units: m.requests,
      tokens: m.totalTokens,
      cents: m.cents,
    }))
    return { totalCents: totalsOf(records).cents, lines }
  }

  // Fallback for any pre-rolled summary shape (root totals + breakdown rows).
  const lines = arrayUnder(payload, ['lines', 'breakdown', 'items', 'data', 'rows']).map((r) => ({
    label: str(r.label) ?? str(r.product) ?? str(r.model) ?? str(r.name) ?? str(r.sku) ?? 'Usage',
    units: num(r.units) ?? num(r.count) ?? num(r.requests) ?? num(r.quantity),
    tokens: num(r.tokens) ?? num(r.totalTokens),
    cents: centsOf(r),
  }))
  const totalFromRoot = num(root.totalCents) ?? (num(root.total) !== undefined ? Math.round((num(root.total) as number) * 100) : undefined)
  const totalCents = totalFromRoot ?? lines.reduce((a, l) => a + l.cents, 0)
  return { totalCents, start: str(root.start) ?? str(root.periodStart), end: str(root.end) ?? str(root.periodEnd), lines }
}

function normalizeInvoices(payload: unknown): Invoice[] {
  return arrayUnder(payload, ['invoices', 'data', 'items', 'rows']).map((r, i) => ({
    id: str(r.id) ?? str(r.number) ?? str(r.invoiceId) ?? `invoice-${i}`,
    date: str(r.date) ?? str(r.created) ?? str(r.createdAt) ?? str(r.issuedAt),
    cents: centsOf(r),
    status: str(r.status) ?? str(r.state),
    url: str(r.url) ?? str(r.hostedInvoiceUrl) ?? str(r.pdf) ?? str(r.invoiceUrl),
  }))
}

/** An object at `r[key]`, or `{}` — for reaching into a nested commerce sub-object. */
const objAt = (r: Record<string, unknown>, key: string): Record<string, unknown> =>
  r[key] && typeof r[key] === 'object' && !Array.isArray(r[key]) ? (r[key] as Record<string, unknown>) : {}

/**
 * An ISO date from a field that may be an ISO string OR a Unix epoch in SECONDS
 * (a `current_period_end`-style seconds stamp) or MILLISECONDS. Returns undefined when absent
 * or unparseable — the caller renders "—", never a fabricated date.
 */
const isoDate = (v: unknown): string | undefined => {
  const s = str(v)
  if (s) return s
  const n = num(v)
  if (n === undefined || n <= 0) return undefined
  // < 1e12 ⇒ seconds; otherwise already milliseconds.
  const ms = n < 1e12 ? n * 1000 : n
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/**
 * Roll a commerce subscription record into the display shape. The plan name
 * and price live in different places across shapes: a flat `plan`, a nested
 * `plan.nickname`/`plan.amount`, or the first `items.data[].price` — read every
 * known location, degrade to "—"/undefined, never invent.
 */
function normalizeSubscriptions(payload: unknown): Subscription[] {
  return arrayUnder(payload, ['subscriptions', 'data', 'items', 'rows']).map((r, i) => {
    const plan = objAt(r, 'plan')
    const firstItem = arrayUnder(objAt(r, 'items'), ['data', 'items'])[0] ?? {}
    const price = objAt(firstItem, 'price')
    const planName =
      str(r.planName) ??
      str(r.plan) ?? // when `plan` is a bare string
      str(plan.nickname) ??
      str(plan.name) ??
      str(plan.id) ??
      str(price.nickname) ??
      str(objAt(price, 'product').name) ??
      str(price.product) ??
      '—'
    const centsVal = num(r.amountCents) ?? num(plan.amount) ?? num(price.unitAmount) ?? num((price as Record<string, unknown>).unit_amount)
    return {
      id: str(r.id) ?? str(r.subscriptionId) ?? `subscription-${i}`,
      plan: planName,
      status: str(r.status) ?? str(r.state),
      quantity: num(r.quantity) ?? num(firstItem.quantity),
      cents: centsVal !== undefined ? Math.round(centsVal) : undefined,
      interval: str(r.interval) ?? str(plan.interval) ?? str(objAt(price, 'recurring').interval),
      currentPeriodEnd:
        isoDate(r.currentPeriodEnd) ?? isoDate((r as Record<string, unknown>).current_period_end) ?? isoDate(r.renewsAt),
      cancelAtPeriodEnd:
        r.cancelAtPeriodEnd === true || (r as Record<string, unknown>).cancel_at_period_end === true,
      canceledAt:
        isoDate(r.canceledAt) ?? isoDate((r as Record<string, unknown>).canceled_at) ?? isoDate(r.cancelAt) ?? undefined,
    }
  })
}

/**
 * Pull a single created/updated record out of the common single-object commerce
 * envelopes ({paymentMethod|payment_method|method|subscription|data|<bare>}), so a
 * mutation response normalizes whether commerce returns the record bare or wrapped.
 * A non-object payload degrades to `{}` (the normalizer then yields honest fallbacks).
 */
function oneRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const p = payload as Record<string, unknown>
  for (const k of ['paymentMethod', 'payment_method', 'method', 'subscription', 'data']) {
    const v = p[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  }
  return p
}

/**
 * Roll a commerce payment-method record into the masked display shape. Reads
 * ONLY the non-sensitive descriptor (brand + last4 + expiry) from `card`/`data` —
 * there is no PAN/CVV/token in this shape and none is ever produced here.
 */
/**
 * Defense-in-depth: keep ONLY the last four digits, no matter what commerce sent.
 * If a full PAN ever lands in `last4` upstream (a commerce bug), this guarantees
 * at most four digits reach the client — strip non-digits, then take the last 4.
 */
function last4Of(v: unknown): string | undefined {
  const digits = (str(v) ?? '').replace(/\D/g, '')
  return digits ? digits.slice(-4) : undefined
}

function normalizePaymentMethods(payload: unknown): PaymentMethod[] {
  return arrayUnder(payload, ['paymentMethods', 'payment_methods', 'data', 'methods', 'rows']).map((r, i) => {
    const card = { ...objAt(r, 'card'), ...objAt(r, 'data') }
    const last4 = last4Of(r.last4) ?? last4Of(card.last4) ?? last4Of((card as Record<string, unknown>).last_four)
    return {
      id: str(r.id) ?? str(r.paymentMethodId) ?? `pm-${i}`,
      type: str(r.type) ?? (last4 ? 'card' : undefined),
      brand: str(r.brand) ?? str(card.brand) ?? str(card.network),
      last4,
      expMonth: num(r.expMonth) ?? num(card.expMonth) ?? num((card as Record<string, unknown>).exp_month),
      expYear: num(r.expYear) ?? num(card.expYear) ?? num((card as Record<string, unknown>).exp_year),
      isDefault: r.isDefault === true || r.default === true || (r as Record<string, unknown>).is_default === true,
    }
  })
}

/**
 * Roll commerce's `spendAlertResponse` shape into the display `SpendAlert`. The
 * list endpoint returns a bare array; `threshold` is USD cents (commerce is cents
 * end-to-end). A missing/renamed field degrades, never throws.
 */
function normalizeSpendAlerts(payload: unknown): SpendAlert[] {
  return arrayUnder(payload, ['spendAlerts', 'alerts', 'data', 'items', 'rows']).map((r, i) => ({
    id: str(r.id) ?? str(r.alertId) ?? `alert-${i}`,
    title: str(r.title) ?? '—',
    thresholdCents: Math.round(num(r.threshold) ?? num(r.thresholdCents) ?? 0),
    currency: (str(r.currency) ?? 'usd').toLowerCase(),
    triggeredAt: isoDate(r.triggeredAt) ?? undefined,
    createdAt: isoDate(r.createdAt) ?? isoDate(r.created) ?? undefined,
    project: str(r.project) ?? '',
    service: str(r.service) ?? '',
    enforce: bool(r.enforce),
    softPct: Math.round(num(r.softPct) ?? num((r as Record<string, unknown>).soft_pct) ?? 80),
    rateLimitRpm: Math.round(
      num(r.rateLimitRpm) ?? num((r as Record<string, unknown>).rate_limit_rpm) ?? num(r.rpm) ?? 0,
    ),
    periodSpentCents: Math.round(
      num(r.periodSpentCents) ?? num((r as Record<string, unknown>).period_spent_cents) ?? num(r.spentCents) ?? 0,
    ),
    over: bool(r.over),
    warn: bool(r.warn),
  }))
}

/** Public Square Web Payments config for the tenant's card form. No secrets. */
export type PaymentConfig = {
  provider: string
  applicationId: string
  locationId: string
  /** 'sandbox' | 'production' — drives which SDK + tokenizer the browser uses. */
  environment: string
  /** True when this deployment charges real cards. */
  live: boolean
}

/** Result of a successful card top-up — the new canonical balance in USD cents. */
export type TopupResult = {
  transactionId: string
  balanceCents: number
  status: string
}

export const BillingApi = {
  /** Cloud credit balance (USD cents) — same proxy as the Wallet/sidebar. */
  balance: (currency = 'usd'): Promise<CloudBalance> =>
    restGet<CloudBalance>(`${billingProxyV1Url('balance')}?currency=${encodeURIComponent(currency)}`),

  /** Metered spend over an optional window (commerce defaults the period). */
  usage: (params?: { start?: string; end?: string }): Promise<Usage> => {
    const qs = new URLSearchParams()
    if (params?.start) qs.set('start', params.start)
    if (params?.end) qs.set('end', params.end)
    const q = qs.toString()
    return restGet<unknown>(`${billingProxyV1Url('usage')}${q ? `?${q}` : ''}`).then(normalizeUsage)
  },

  /** The tenant's invoice history (most recent first, as commerce returns it). */
  invoices: (): Promise<Invoice[]> => restGet<unknown>(billingProxyV1Url('invoices')).then(normalizeInvoices),

  /** The org's subscriptions (plan, status, renewal, cancel state). */
  subscriptions: (): Promise<Subscription[]> =>
    restGet<unknown>(billingProxyV1Url('subscriptions')).then(normalizeSubscriptions),

  /**
   * Cancel a subscription (`POST /v1/billing/subscriptions/:id/cancel`). `atPeriodEnd`
   * true schedules the cancel for the end of the current period (keeps access until
   * `currentPeriodEnd`); false cancels immediately. The `:id` comes from the caller's
   * OWN subscriptions list (already scoped by the proxy), and commerce re-authorizes
   * the id against the caller's server-pinned subject (404s a foreign id). Returns the
   * updated subscription so the row reflects the new cancel state.
   */
  cancelSubscription: (id: string, atPeriodEnd: boolean): Promise<Subscription> =>
    restPost<unknown>(billingProxyV1Url(`subscriptions/${encodeURIComponent(id)}/cancel`), {
      atPeriodEnd,
    }).then((r) => normalizeSubscriptions([oneRecord(r)])[0]),

  /**
   * Reactivate a subscription scheduled to cancel at period end
   * (`POST /v1/billing/subscriptions/:id/reactivate`) — clears `cancelAtPeriodEnd`
   * before the period closes. Same server-side subject authorization as cancel.
   */
  reactivateSubscription: (id: string): Promise<Subscription> =>
    restPost<unknown>(billingProxyV1Url(`subscriptions/${encodeURIComponent(id)}/reactivate`)).then((r) =>
      normalizeSubscriptions([oneRecord(r)])[0],
    ),

  /** The org's saved payment methods (masked brand + last4 only). */
  paymentMethods: (): Promise<PaymentMethod[]> =>
    restGet<unknown>(billingProxyV1Url('methods')).then(normalizePaymentMethods),

  /**
   * Save a card as a payment method (`POST /v1/billing/methods`) from a
   * single-use Square nonce. The RAW PAN NEVER touches our code — the browser
   * tokenizes the card IN Square's iframe and sends ONLY the opaque `token` (nonce)
   * + the method `type`. The proxy pins the billing subject server-side
   * (`scopedBillingBody`), so the browser needn't know its subject and cannot save a
   * method against another tenant. Returns the created (masked) method.
   */
  createPaymentMethod: (input: { type?: string; token: string }): Promise<PaymentMethod> =>
    restPost<unknown>(billingProxyV1Url('methods'), {
      type: input.type ?? 'card',
      token: input.token,
    }).then((r) => normalizePaymentMethods([oneRecord(r)])[0]),

  /**
   * Detach a saved payment method (`DELETE /v1/billing/methods/:id`). The
   * proxy authenticates the session, injects the service token, and stamps the
   * caller's OWN subject + `X-Org-Id`; commerce authorizes the delete against that
   * subject and 404s a method the caller doesn't own (defense in depth) — so a
   * browser can never detach another tenant's card by id.
   */
  removePaymentMethod: (id: string): Promise<void> =>
    restDelete(billingProxyV1Url(`methods/${encodeURIComponent(id)}`)),

  /**
   * The org's spend alerts / budgets (`GET /v1/billing/alerts`). The proxy
   * scopes the read to the caller's OWN subject (pins `?user=`), so this returns
   * only the caller's budgets.
   */
  spendAlerts: (): Promise<SpendAlert[]> =>
    restGet<unknown>(billingProxyV1Url('alerts')).then(normalizeSpendAlerts),

  /**
   * Create a spend alert / budget (`POST /v1/billing/alerts`). The subject is
   * pinned server-side by the proxy (`scopedBillingBody`) — the browser sends only
   * the title + threshold (USD cents) + currency, and cannot create a budget for
   * another tenant. Returns the created alert.
   */
  createSpendAlert: (input: {
    title: string
    thresholdCents: number
    currency?: string
    project?: string
    service?: string
    enforce?: boolean
    softPct?: number
    rateLimitRpm?: number
  }): Promise<SpendAlert> =>
    restPost<unknown>(billingProxyV1Url('alerts'), {
      title: input.title,
      threshold: Math.round(input.thresholdCents),
      currency: (input.currency ?? 'usd').toLowerCase(),
      project: input.project ?? '',
      service: input.service ?? '',
      enforce: input.enforce ?? false,
      softPct: input.softPct ?? 80,
      rateLimitRpm: input.rateLimitRpm ?? 0,
    }).then((r) => normalizeSpendAlerts([r])[0]),

  /**
   * Update a budget's cap / scope / enforcement (`PATCH /v1/billing/alerts/:id`).
   * Only the provided fields are sent; the subject is pinned server-side by the proxy
   * (a caller can only edit their OWN budgets). Returns the updated alert.
   */
  updateSpendAlert: (
    id: string,
    patch: {
      title?: string
      thresholdCents?: number
      project?: string
      service?: string
      enforce?: boolean
      softPct?: number
      rateLimitRpm?: number
    },
  ): Promise<SpendAlert> => {
    const body: Record<string, unknown> = {}
    if (patch.title !== undefined) body.title = patch.title
    if (patch.thresholdCents !== undefined) body.threshold = Math.round(patch.thresholdCents)
    if (patch.project !== undefined) body.project = patch.project
    if (patch.service !== undefined) body.service = patch.service
    if (patch.enforce !== undefined) body.enforce = patch.enforce
    if (patch.softPct !== undefined) body.softPct = patch.softPct
    if (patch.rateLimitRpm !== undefined) body.rateLimitRpm = patch.rateLimitRpm
    return restPatch<unknown>(billingProxyV1Url(`alerts/${encodeURIComponent(id)}`), body).then(
      (r) => normalizeSpendAlerts([r])[0],
    )
  },

  /** Remove a budget (`DELETE /v1/billing/alerts/:id`); subject pinned server-side. */
  deleteSpendAlert: (id: string): Promise<void> =>
    restDelete(billingProxyV1Url(`alerts/${encodeURIComponent(id)}`)),

  /**
   * PUBLIC Square Web Payments config for THIS org (`GET /v1/billing/settings`):
   * the application id + location id + environment the browser SDK tokenizes a card
   * with. Every field is public (no secret). Commerce resolves sandbox-vs-production
   * through its single SQUARE_ENVIRONMENT authority, so the app id the browser
   * tokenizes with always matches the account commerce will charge.
   */
  paymentConfig: (): Promise<PaymentConfig> => restGet<PaymentConfig>(billingProxyV1Url('settings')),

  /**
   * Charge a Square Web Payments nonce and credit the org's CANONICAL balance
   * (`POST /v1/billing/topup/token`) — the same per-org ledger the gateway gates
   * AI usage on. The browser sends only the single-use `sourceId` (never card
   * data) + the amount in USD cents; the proxy pins the billing subject
   * server-side, and commerce credits the exact key the gateway reads/debits.
   *
   * Idempotent by the single-use nonce: a retry with the same `sourceId` replays
   * the first result rather than double-charging. Returns the new balance (cents).
   */
  topupWithCard: (input: { sourceId: string; amountCents: number; currency?: string }): Promise<TopupResult> =>
    restPost<TopupResult>(billingProxyV1Url('topup/token'), {
      sourceId: input.sourceId,
      amountCents: Math.round(input.amountCents),
      currency: (input.currency ?? 'usd').toLowerCase(),
    }),
}
