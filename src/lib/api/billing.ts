/**
 * Billing — the signed-in tenant's money surface (commerce, hanzoai/commerce):
 * credit balance, metered usage, invoices, subscriptions, and payment methods.
 *
 * Every call goes through the console's OWN same-origin `/billing/*` server proxy
 * (`app/billing/[...path]/route.ts`), which injects the commerce SERVICE token
 * server-side and scopes every request to the caller's OWN org/billing-subject —
 * the browser never holds a commerce credential and cannot widen scope. The
 * subject is the SAME one the gateway debits, so what the console shows is what
 * actually gets charged.
 *
 * Read-only here: WRITES (paying, adding/removing a payment method, changing a
 * subscription) stay in the brand billing portal (`config.billingUrl`), which the
 * pages link to — the console reads and displays, it does not mutate money state.
 * Shapes are intentionally permissive: commerce's Stripe-shaped payloads are
 * normalized defensively so a field rename upstream degrades a cell to "—" rather
 * than throwing, and card data is masked to brand + last4 (never a PAN/CVV/token).
 * On a 404/501/401 the caller renders the shared `BackendStateCard` — never
 * fabricated spend, balance, or card data.
 */
import { restGet } from './client'
import type { CloudBalance } from './wallet'
import { normalizeUsageRecords, perModel, totalsOf } from './aimetrics'

/** Same-origin URL for the `/billing/*` server proxy (NOT the `/v1` gateway). */
const billingUrl = (path: string): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/billing/${path.replace(/^\/+/, '')}`
}

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
  /** Commerce/Stripe status — active, trialing, past_due, canceled, etc. */
  status?: string
  /** Seats / units, if the subscription reports a quantity. */
  quantity?: number
  /** Recurring price in USD cents, if reported. */
  cents?: number
  /** Billing interval — month, year, etc. */
  interval?: string
  /** ISO end of the current billing period (renewal date). */
  currentPeriodEnd?: string
}

/**
 * One saved payment method (commerce `/v1/billing/payment-methods`). Carries ONLY
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

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

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
 * (Stripe's `current_period_end`) or MILLISECONDS. Returns undefined when absent
 * or unparseable — the caller renders "—", never a fabricated date.
 */
const isoDate = (v: unknown): string | undefined => {
  const s = str(v)
  if (s) return s
  const n = num(v)
  if (n === undefined || n <= 0) return undefined
  // < 1e12 ⇒ seconds (Stripe); otherwise already milliseconds.
  const ms = n < 1e12 ? n * 1000 : n
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/**
 * Roll a commerce/Stripe subscription record into the display shape. The plan name
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
    }
  })
}

/**
 * Roll a commerce/Stripe payment-method record into the masked display shape. Reads
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

export const BillingApi = {
  /** Cloud credit balance (USD cents) — same proxy as the Wallet/sidebar. */
  balance: (currency = 'usd'): Promise<CloudBalance> =>
    restGet<CloudBalance>(`${billingUrl('balance')}?currency=${encodeURIComponent(currency)}`),

  /** Metered spend over an optional window (commerce defaults the period). */
  usage: (params?: { start?: string; end?: string }): Promise<Usage> => {
    const qs = new URLSearchParams()
    if (params?.start) qs.set('start', params.start)
    if (params?.end) qs.set('end', params.end)
    const q = qs.toString()
    return restGet<unknown>(`${billingUrl('usage')}${q ? `?${q}` : ''}`).then(normalizeUsage)
  },

  /** The tenant's invoice history (most recent first, as commerce returns it). */
  invoices: (): Promise<Invoice[]> => restGet<unknown>(billingUrl('invoices')).then(normalizeInvoices),

  /** The org's subscriptions (plan, status, renewal) — read-only. */
  subscriptions: (): Promise<Subscription[]> =>
    restGet<unknown>(billingUrl('subscriptions')).then(normalizeSubscriptions),

  /** The org's saved payment methods (masked brand + last4 only) — read-only. */
  paymentMethods: (): Promise<PaymentMethod[]> =>
    restGet<unknown>(billingUrl('payment-methods')).then(normalizePaymentMethods),
}
