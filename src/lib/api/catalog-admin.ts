/**
 * Catalog admin API — the platform product/pricing CATALOG editor (admin.hanzo.ai).
 *
 * commerce owns the catalog as the source of truth (`catalog-entry`, the "system"
 * namespace): the 17 infra tiers increment 1 seeded (11 cloud + 3 gpu + 3
 * datastore), plus every product surface docs/pricing/the console read from. This
 * client drives its SuperAdmin CRUD:
 *   GET    /v1/commerce/catalog/entries          — list (incl. unpublished + cost/margin)
 *   POST   /v1/commerce/catalog/entries          — create (unique slug)
 *   PUT    /v1/commerce/catalog/entries/:slug     — update (slug identity is immutable)
 *   DELETE /v1/commerce/catalog/entries/:slug     — delete
 *   POST   /v1/commerce/catalog/seed             — upsert the embedded seed (non-destructive)
 *
 * SOURCE + AUTH: the console's OWN same-origin `/v1/commerce/catalog/*` (`cloudProxyV1Url`).
 * On the standalone console (admin.hanzo.ai / dev) this terminates at the console's
 * `app/v1/commerce/catalog/[...path]` user-bearer proxy → commerce; on the go:embed console
 * (console.hanzo.ai) the SAME path hits the cloud binary's embedded commerce mount
 * directly. Either way the org is server-authoritative (the Bearer/session owner),
 * and commerce's `requireSuperAdmin` (owner=="admin") is the authoritative gate —
 * a non-admin gets an honest 403, never catalog write access. These handlers speak
 * BARE JSON (not the casibase envelope), so the plain-REST transport is used.
 *
 * Everything is OPTIONAL-SAFE: `normalizeEntry` maps whatever commerce returns onto
 * `CatalogEntry`, so a small backend-shape drift degrades gracefully rather than
 * throwing, and a deployment where the surface isn't routed (404) renders an honest
 * state — never fabricated rows.
 */
import { cloudProxyV1Url, restGet, restPost, restPut, restDelete } from './client'

/** The PUBLIC pricing block for a catalog entry (projected to everyone). */
export interface CatalogPricing {
  publicPrice: string
  planTiers?: string[]
  usageMeter?: string
}

/** The PRIVATE, admin-only unit economics (never in the public projection). */
export interface CatalogEconomics {
  cost: string
  marginPct?: number
}

/**
 * One platform catalog entry, mirroring commerce's `catalogentry.CatalogEntry`.
 * `slug` (== id) is the stable, globally-unique key an entry is addressed by. The
 * structured spec rides `metadata` (the JSON hatch); the public price rides
 * `priceCents`; the admin-only unit cost + margin ride `costCents`/`marginPct`.
 */
export interface CatalogEntry {
  slug: string
  name: string
  category: string
  description: string
  iconKey: string
  brandColor: string
  route: string
  docsUrl: string
  apiPath: string
  apiRoute?: string
  githubUrl?: string
  external?: boolean
  pricing?: CatalogPricing
  private?: CatalogEconomics
  /** References a pricing plan by key (plans/<key>.json); '' ⇒ no plan. */
  pricingId: string
  /** The PUBLIC price a customer pays, in integer cents. */
  priceCents: number
  currency: string
  /** The platform's own unit cost (admin-only economics), in integer cents. */
  costCents: number
  /** Target gross margin percent (admin-only economics). */
  marginPct: number
  status: string
  repo?: string
  admin?: boolean
  brands?: string[]
  order: number
  published: boolean
  productId?: string
  /** The structured spec (vcpus/memoryGB/… for cloud, gpu/vram/price for gpu, …). */
  metadata: Record<string, unknown>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const bool = (v: unknown): boolean => v === true

function normalizePricing(raw: unknown): CatalogPricing | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return {
    publicPrice: str(r.publicPrice),
    planTiers: Array.isArray(r.planTiers) ? r.planTiers.filter((t): t is string => typeof t === 'string') : undefined,
    usageMeter: str(r.usageMeter) || undefined,
  }
}

function normalizeEconomics(raw: unknown): CatalogEconomics | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return { cost: str(r.cost), marginPct: typeof r.marginPct === 'number' ? r.marginPct : undefined }
}

/** Map an arbitrary entry payload onto `CatalogEntry` (optional-safe, tolerant of
 *  a missing field). `metadata` is passed through verbatim (any JSON object). */
export function normalizeEntry(raw: unknown): CatalogEntry {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    slug: str(r.slug),
    name: str(r.name),
    category: str(r.category),
    description: str(r.description),
    iconKey: str(r.iconKey),
    brandColor: str(r.brandColor),
    route: str(r.route),
    docsUrl: str(r.docsUrl),
    apiPath: str(r.apiPath),
    apiRoute: str(r.apiRoute) || undefined,
    githubUrl: str(r.githubUrl) || undefined,
    external: bool(r.external),
    pricing: normalizePricing(r.pricing),
    private: normalizeEconomics(r.private),
    pricingId: str(r.pricingId),
    priceCents: num(r.priceCents),
    currency: str(r.currency) || 'usd',
    costCents: num(r.costCents),
    marginPct: num(r.marginPct),
    status: str(r.status) || 'enabled',
    repo: str(r.repo) || undefined,
    admin: bool(r.admin),
    brands: Array.isArray(r.brands) ? r.brands.filter((b): b is string => typeof b === 'string') : undefined,
    order: num(r.order),
    published: r.published === undefined ? true : bool(r.published),
    productId: str(r.productId) || undefined,
    metadata: r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {},
  }
}

/** Normalize a list payload (tolerate a bare array or a `{entries|data|items}` wrap). */
function normalizeList(data: unknown): CatalogEntry[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { entries?: unknown[] })?.entries)
      ? (data as { entries: unknown[] }).entries
      : Array.isArray((data as { data?: unknown[] })?.data)
        ? (data as { data: unknown[] }).data
        : Array.isArray((data as { items?: unknown[] })?.items)
          ? (data as { items: unknown[] }).items
          : []
  return list.map(normalizeEntry)
}

/** The editable fields sent on create/update. The slug is the path key on update
 *  (immutable — commerce pins the path slug over any body value). */
export type CatalogEntryInput = {
  slug: string
  name: string
  category: string
  description: string
  priceCents: number
  currency: string
  pricingId: string
  costCents: number
  marginPct: number
  order: number
  published: boolean
  metadata: Record<string, unknown>
}

const entryUrl = (slug: string): string => cloudProxyV1Url(`commerce/catalog/entries/${encodeURIComponent(slug)}`)

export const CatalogAdminApi = {
  /** List every catalog entry (admin view — includes unpublished + cost/margin).
   *  Optional `?brand=` filter (e.g. `infra` for the 17 infra tiers). Throws a
   *  typed `ApiError` (403 non-admin, 404 not routed) the caller renders honestly. */
  list: async (brand?: string): Promise<CatalogEntry[]> => {
    const url = cloudProxyV1Url('commerce/catalog/entries') + (brand ? `?brand=${encodeURIComponent(brand)}` : '')
    return normalizeList(await restGet<unknown>(url))
  },

  /** Create a catalog entry (unique slug required). Returns the created entry. */
  create: async (input: CatalogEntryInput): Promise<CatalogEntry> =>
    normalizeEntry(await restPost<unknown>(cloudProxyV1Url('commerce/catalog/entries'), input)),

  /** Update a catalog entry by slug (the slug identity is preserved server-side). */
  update: async (slug: string, input: CatalogEntryInput): Promise<CatalogEntry> =>
    normalizeEntry(await restPut<unknown>(entryUrl(slug), input)),

  /** Delete a catalog entry by slug (204). */
  remove: async (slug: string): Promise<void> => {
    await restDelete(entryUrl(slug))
  },

  /** Upsert the embedded catalog seed (idempotent, non-destructive). Returns the
   *  number of entries created (0 once the catalog is populated). */
  seed: async (): Promise<number> => {
    const r = (await restPost<{ created?: number }>(cloudProxyV1Url('commerce/catalog/seed'))) ?? {}
    return typeof r.created === 'number' ? r.created : 0
  },
}
