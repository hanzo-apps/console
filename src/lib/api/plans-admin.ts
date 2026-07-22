/**
 * Plans admin API — the platform SUBSCRIPTION/DNS plan authority editor (admin.hanzo.ai).
 *
 * commerce owns the plan authority as the source of truth (`models/plan`, the "system"
 * namespace): the subscription tiers + DNS plans that `GET /v1/billing/plans` and the
 * internal-ledger renewal charge derive from. This client drives its SuperAdmin CRUD:
 *   GET    /v1/plans/entries          — list (raw admin rows)
 *   POST   /v1/plans/entries          — create (unique slug)
 *   PUT    /v1/plans/entries/:slug     — update (slug IMMUTABLE — the handler rejects a
 *                                        body slug ≠ path slug with 400)
 *   DELETE /v1/plans/entries/:slug     — delete
 *   POST   /v1/plans/seed             — upsert the embedded seed (non-destructive)
 *
 * MONEY-ADJACENT: a plan's `price` is the real monthly renewal charge, so editing it
 * changes what subscribers pay — this is a live billing control, SuperAdmin-gated by
 * commerce (`requireSuperAdmin`, owner=="admin"). The free($0) vs custom(null,
 * `contactSales`) distinction is preserved as sent (never coerced null→0).
 *
 * SOURCE + AUTH: the console's OWN same-origin `/v1/plans/*` (`cloudProxyV1Url`) →
 * the standalone `app/v1/plans/[...path]` user-bearer proxy → commerce; on the go:embed
 * console the SAME path hits the cloud binary's embedded commerce. Bare JSON (not the
 * casibase envelope), so the plain-REST transport is used. Optional-safe normalizers.
 */
import { cloudProxyV1Url, restGet, restPost, restPut, restDelete } from './client'

/**
 * One platform plan, mirroring commerce's `models/plan.Plan`. `slug` (== id) is the
 * stable, globally-unique key an entry is addressed by and is IMMUTABLE on update.
 * `price`/`priceAnnual` are the monthly charge (billed monthly / when billed annually),
 * in integer cents. `metadata` is the features/limits envelope.
 */
export interface Plan {
  slug: string
  sku: string
  name: string
  description: string
  /** Plan family — personal / team / enterprise / world / social / dns. */
  category: string
  /** Monthly renewal charge, integer cents. Editing this changes what subscribers pay. */
  price: number
  /** Per-month price when billed annually, integer cents. */
  priceAnnual: number
  currency: string
  /** Billing interval (default "month"). */
  interval: string
  intervalCount: number
  trialPeriodDays: number
  /** Billed per seat — invoices charge price × quantity. */
  perSeat: boolean
  /** Custom / "contact sales" plan whose price is NULL (not $0). */
  contactSales: boolean
  /** Highlighted tier within its category (display only). */
  popular: boolean
  /** The features/limits envelope (any JSON object). */
  metadata: Record<string, unknown>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const bool = (v: unknown): boolean => v === true

/** Map an arbitrary plan payload onto `Plan` (optional-safe). `metadata` is passed
 *  through verbatim (any JSON object). */
export function normalizePlan(raw: unknown): Plan {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    slug: str(r.slug),
    sku: str(r.sku),
    name: str(r.name),
    description: str(r.description),
    category: str(r.category),
    price: num(r.price),
    priceAnnual: num(r.priceAnnual),
    currency: str(r.currency) || 'usd',
    interval: str(r.interval) || 'month',
    intervalCount: num(r.intervalCount),
    trialPeriodDays: num(r.trialPeriodDays),
    perSeat: bool(r.perSeat),
    contactSales: bool(r.contactSales),
    popular: bool(r.popular),
    metadata: r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {},
  }
}

/** Normalize a list payload (tolerate a bare array or a `{plans|entries|data}` wrap). */
function normalizeList(data: unknown): Plan[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { plans?: unknown[] })?.plans)
      ? (data as { plans: unknown[] }).plans
      : Array.isArray((data as { entries?: unknown[] })?.entries)
        ? (data as { entries: unknown[] }).entries
        : Array.isArray((data as { data?: unknown[] })?.data)
          ? (data as { data: unknown[] }).data
          : []
  return list.map(normalizePlan)
}

/** The editable fields sent on create/update. On update the slug is the path key
 *  (immutable — commerce rejects a body slug ≠ path slug). */
export type PlanInput = {
  slug: string
  name: string
  description: string
  category: string
  price: number
  priceAnnual: number
  currency: string
  trialPeriodDays: number
  perSeat: boolean
  contactSales: boolean
  popular: boolean
  metadata: Record<string, unknown>
}

const entryUrl = (slug: string): string => cloudProxyV1Url(`plans/entries/${encodeURIComponent(slug)}`)

export const PlansAdminApi = {
  /** List every plan (admin view). Throws a typed `ApiError` (403 non-admin, 404 not
   *  routed) the caller renders as an honest state. */
  list: async (): Promise<Plan[]> => normalizeList(await restGet<unknown>(cloudProxyV1Url('plans/entries'))),

  /** Create a plan (unique slug required). Returns the created plan. */
  create: async (input: PlanInput): Promise<Plan> =>
    normalizePlan(await restPost<unknown>(cloudProxyV1Url('plans/entries'), input)),

  /** Update a plan by slug (the slug identity is immutable — commerce pins the path slug). */
  update: async (slug: string, input: PlanInput): Promise<Plan> =>
    normalizePlan(await restPut<unknown>(entryUrl(slug), input)),

  /** Delete a plan by slug (204). */
  remove: async (slug: string): Promise<void> => {
    await restDelete(entryUrl(slug))
  },

  /** Upsert the embedded plan seed (idempotent, non-destructive). Returns the number created. */
  seed: async (): Promise<number> => {
    const r = (await restPost<{ created?: number }>(cloudProxyV1Url('plans/seed'))) ?? {}
    return typeof r.created === 'number' ? r.created : 0
  },
}
