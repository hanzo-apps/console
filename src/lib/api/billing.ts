/**
 * Billing — usage + invoices for the signed-in tenant (commerce, hanzoai/commerce).
 *
 * Both calls go through the console's OWN same-origin `/billing/*` server proxy
 * (`app/billing/[...path]/route.ts`), which injects the commerce SERVICE token
 * server-side and scopes every request to the caller's OWN org/billing-subject —
 * the browser never holds a commerce credential and cannot widen scope. The
 * subject is the SAME one the gateway debits, so what the Cost page shows is what
 * actually gets charged.
 *
 * Read-only here (the money surface — paying / payment methods — stays in the
 * brand billing portal, `config.billingUrl`). Shapes are intentionally permissive:
 * commerce's usage/invoice payloads are normalized defensively so a field rename
 * upstream degrades a cell to "—" rather than throwing. On a 404/501/401 the
 * caller renders the shared `BackendStateCard` — never fabricated spend.
 */
import { restGet } from './client'
import type { CloudBalance } from './wallet'

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

function normalizeUsage(payload: unknown): Usage {
  const root = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {})
  const lines = arrayUnder(payload, ['lines', 'breakdown', 'items', 'usage', 'data', 'rows']).map((r) => ({
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
}
