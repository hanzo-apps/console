/**
 * Commerce store API — Hanzo Commerce (`hanzoai/commerce`), the merchant catalog:
 * products, orders, customers, inventory (variants), collections, discounts, and the
 * storefront settings. This is the STORE surface; money (balance / usage / invoices /
 * Square) is a separate concern served by `billing.ts` over the `/billing` proxy — the
 * two never mix.
 *
 * Every call is the CANONICAL, prefix-free `/v1/commerce/<resource>` (`cUrl('product')` →
 * `<origin>/v1/commerce/product`); `next.config` rewrites `/v1/commerce/*` to the console's
 * OWN same-origin user-bearer `/commerce` proxy (the billing twin): the server route
 * mints a short-lived user-bound IAM token and commerce resolves the org from the
 * token's `owner` claim, so every read/write is org-scoped SERVER-SIDE — a merchant
 * only ever sees their OWN org's store. No credential reaches the browser and the org
 * can never be widened from the client.
 *
 * Plain REST (raw JSON, real HTTP status) like the Functions / Agents facades — the
 * `restGet/restPost/restDelete` transport, not the casibase envelope. Commerce wraps a
 * list as `{ count, models, facets }`; a create/get returns the bare record. Payloads
 * are normalized DEFENSIVELY: a field rename upstream degrades a cell to "—" rather
 * than throwing, and the row array is read from whichever envelope key the backend
 * uses (`models` / `data` / `items`). Nothing is fabricated — an empty store renders an
 * honest empty state, never placeholder rows.
 */
import { restGet, restPost, restDelete, commerceProxyV1Url } from './client'

const enc = encodeURIComponent

/**
 * The one commerce URL builder: the canonical same-origin `/v1/commerce/<resource>`
 * (the /v1-first law), via `commerceProxyV1Url`. Standalone (console2/admin):
 * `/v1/commerce/*` resolves to the console's OWN `app/v1/commerce/[...path]` user-bearer
 * route handler (MORE SPECIFIC than the `/v1/[...path]` cloud BFF), which mints a
 * short-lived user token and commerce scopes the org from the Bearer owner. Embed
 * (console.hanzo.ai): the same `/v1/commerce/*` is served by the cloud binary under the
 * first-party session cookie (the billing twin). Callers pass the bare REST model
 * (`product` / `store/current`); this namespaces it once.
 */
const cUrl = (resource: string): string => commerceProxyV1Url(resource)

// ── Coercion helpers (defensive, agents.ts style) ───────────────────────────
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array found under any common list-envelope key (or the root). */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
    }
  }
  return []
}

/** First present, non-empty string among candidate keys. */
const pick = (r: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const s = str(r[k])
    if (s) return s
  }
  return undefined
}
/** First present, finite number among candidate keys. */
const pickNum = (r: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const k of keys) {
    const n = num(r[k])
    if (n !== undefined) return n
  }
  return undefined
}

// ── Domain types (only the fields the dashboard shows; all optional-safe) ────

export type CommerceProduct = {
  id: string
  name: string
  sku?: string
  slug?: string
  /** Unit price in the smallest currency unit (cents), if the record carries one. */
  priceCents?: number
  currency?: string
  inventory?: number
  available: boolean
  hidden: boolean
  createdAt?: string
}

export type CommerceOrder = {
  id: string
  number?: string
  customer?: string
  email?: string
  totalCents?: number
  currency?: string
  status?: string
  createdAt?: string
}

export type CommerceCustomer = {
  id: string
  name?: string
  email?: string
  createdAt?: string
}

export type CommerceVariant = {
  id: string
  name?: string
  sku?: string
  priceCents?: number
  inventory?: number
  createdAt?: string
}

export type CommerceDiscount = {
  id: string
  code?: string
  name?: string
  type?: string
  /** Percent (0-100) or amount in cents, per `type`. */
  value?: number
  active: boolean
  createdAt?: string
}

export type CommerceStore = {
  id: string
  name?: string
  slug?: string
  currency?: string
  createdAt?: string
}

/** A normalized list result: the rows plus the raw returned count (advisory only —
 *  commerce echoes the page limit here, so the UI shows `rows.length`, not this). */
export type CommerceList<T> = { rows: T[]; count: number }

// ── Normalizers (pure — exported for unit tests) ─────────────────────────────

const idOf = (r: Record<string, unknown>): string => pick(r, ['id', '_id', 'objectId', 'key']) ?? ''

export const normalizeProduct = (raw: unknown): CommerceProduct => {
  const r = asRecord(raw)
  return {
    id: idOf(r),
    name: pick(r, ['name', 'title', 'slug', 'sku']) ?? '(unnamed)',
    sku: pick(r, ['sku', 'upc']),
    slug: pick(r, ['slug', 'handle']),
    priceCents: pickNum(r, ['price', 'priceCents', 'amount']),
    currency: pick(r, ['currency', 'currencyCode']),
    inventory: pickNum(r, ['inventory', 'stock', 'quantity']),
    available: bool(r.available ?? r.published ?? r.active),
    hidden: bool(r.hidden),
    createdAt: pick(r, ['createdAt', 'createdTime', 'created_at']),
  }
}

export const normalizeOrder = (raw: unknown): CommerceOrder => {
  const r = asRecord(raw)
  const cust = asRecord(r.customer ?? r.user)
  return {
    id: idOf(r),
    number: pick(r, ['number', 'orderNumber', 'displayId', 'name']) ?? idOf(r),
    customer:
      pick(r, ['customerName', 'customerEmail']) ??
      pick(cust, ['name', 'email', 'firstName']) ??
      pick(r, ['email', 'userId']),
    email: pick(r, ['email', 'customerEmail']) ?? pick(cust, ['email']),
    totalCents: pickNum(r, ['total', 'totalCents', 'amount', 'grandTotal']),
    currency: pick(r, ['currency', 'currencyCode']),
    status: pick(r, ['status', 'state', 'fulfillmentStatus', 'paymentStatus']),
    createdAt: pick(r, ['createdAt', 'createdTime', 'created_at']),
  }
}

export const normalizeCustomer = (raw: unknown): CommerceCustomer => {
  const r = asRecord(raw)
  const first = pick(r, ['firstName', 'givenName'])
  const last = pick(r, ['lastName', 'familyName'])
  const full = (pick(r, ['name', 'displayName', 'fullName']) ?? [first, last].filter(Boolean).join(' ')) || undefined
  return {
    id: idOf(r),
    name: full,
    email: pick(r, ['email', 'emailAddress']),
    createdAt: pick(r, ['createdAt', 'createdTime', 'created_at']),
  }
}

export const normalizeVariant = (raw: unknown): CommerceVariant => {
  const r = asRecord(raw)
  return {
    id: idOf(r),
    name: pick(r, ['name', 'title', 'productName']),
    sku: pick(r, ['sku', 'upc']),
    priceCents: pickNum(r, ['price', 'priceCents', 'amount']),
    inventory: pickNum(r, ['inventory', 'stock', 'quantity']),
    createdAt: pick(r, ['createdAt', 'createdTime', 'created_at']),
  }
}

export const normalizeDiscount = (raw: unknown): CommerceDiscount => {
  const r = asRecord(raw)
  return {
    id: idOf(r),
    code: pick(r, ['code', 'couponCode']),
    name: pick(r, ['name', 'title', 'description']),
    type: pick(r, ['type', 'discountType', 'valueType']),
    value: pickNum(r, ['value', 'amount', 'percentage', 'percent']),
    active: bool(r.active ?? r.enabled ?? !bool(r.disabled)),
    createdAt: pick(r, ['createdAt', 'createdTime', 'created_at']),
  }
}

export const normalizeStore = (raw: unknown): CommerceStore => {
  const r = asRecord(raw)
  return {
    id: idOf(r),
    name: pick(r, ['name', 'title']),
    slug: pick(r, ['slug', 'handle']),
    currency: pick(r, ['currency', 'currencyCode', 'defaultCurrency']),
    createdAt: pick(r, ['createdAt', 'createdTime', 'created_at']),
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

type ListParams = { limit?: number; page?: number; q?: string; sort?: string }

/** GET a commerce REST model list, normalized. `kind` is the singular REST name. */
async function fetchList<T>(
  kind: string,
  normalize: (raw: unknown) => T,
  params?: ListParams,
): Promise<CommerceList<T>> {
  const qs = new URLSearchParams()
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.page) qs.set('page', String(params.page))
  if (params?.q) qs.set('q', params.q)
  if (params?.sort) qs.set('sort', params.sort)
  const suffix = qs.toString() ? `?${qs}` : ''
  const payload = await restGet<unknown>(`${cUrl(kind)}${suffix}`)
  const rows = arrayUnder(payload, ['models', 'data', 'items', 'rows']).map(normalize)
  const count = num(asRecord(payload).count) ?? rows.length
  return { rows, count }
}

/** The commerce store API — one facade, org-scoped by the `/commerce` proxy. */
export const CommerceApi = {
  products: (p?: ListParams) => fetchList('product', normalizeProduct, { limit: 100, ...p }),
  orders: (p?: ListParams) => fetchList('order', normalizeOrder, { limit: 100, ...p }),
  customers: (p?: ListParams) => fetchList('user', normalizeCustomer, { limit: 100, ...p }),
  variants: (p?: ListParams) => fetchList('variant', normalizeVariant, { limit: 100, ...p }),
  discounts: (p?: ListParams) => fetchList('discount', normalizeDiscount, { limit: 100, ...p }),
  stores: (p?: ListParams) => fetchList('store', normalizeStore, { limit: 100, ...p }),

  /**
   * The org's default storefront settings (`GET /v1/commerce/store/current` — commerce returns the
   * first store, or a synthesized minimal one when none exists). Commerce wraps it as
   * `{ store: {...} }` (verified live), so unwrap `.store` before normalizing (a bare object
   * still works). Org-scoped server-side.
   */
  currentStore: () =>
    restGet<unknown>(cUrl('store/current')).then((p) => normalizeStore(asRecord(p).store ?? p)),

  /** Create a product (name/sku/slug required by commerce's validator). */
  createProduct: (body: { name: string; sku: string; slug: string; description?: string; available?: boolean }) =>
    restPost<unknown>(cUrl('product'), { available: true, ...body }).then(normalizeProduct),

  /** Delete a product by id. */
  deleteProduct: (id: string) => restDelete(cUrl(`product/${enc(id)}`)),
}
