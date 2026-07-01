/**
 * Marketplace — pure browse/grouping logic over the REAL model catalog
 * (`aicatalog.fetchCatalog` → `/v1/pricing/models`). No I/O, no GUI, so it is
 * unit-testable and the module stays a thin renderer.
 *
 * The Marketplace is the storefront view of the same real catalog the Model
 * Catalog + Providers pages read: listings are grouped into marketplace
 * CATEGORIES (by modality — Text/Vision/Image/…), a FEATURED shelf is lifted from
 * the catalog's own `featured` flag (falling back to the cheapest available
 * models when the feed marks none), and search is a plain case-insensitive filter.
 * Nothing here fabricates a listing, a price, or a count — every value flows from
 * the catalog record.
 */
import {
  modelType,
  modelDisplayName,
  displayProvider,
  matchesQuery,
  modelContext,
  type CatalogEntry,
} from '~/lib/api/aicatalog'

/** One marketplace category — a modality bucket with its real listings. */
export type MarketCategory = {
  /** The modality label (Text, Vision, Image, Audio, Embedding, Rerank, Agent). */
  type: string
  /** The listings in this category (the real catalog models). */
  models: CatalogEntry[]
  /** Count — models in the category. */
  count: number
  /** How many are servable right now (real availability). */
  available: number
}

/** Display order for the modality categories (unknown types sort last, A–Z). */
const TYPE_ORDER = ['Text', 'Vision', 'Image', 'Audio', 'Embedding', 'Rerank', 'Agent']

/** Group listings into marketplace categories by modality, ordered for display. */
export function categorize(models: CatalogEntry[]): MarketCategory[] {
  const by = new Map<string, CatalogEntry[]>()
  for (const m of models) {
    const t = modelType(m)
    const arr = by.get(t)
    if (arr) arr.push(m)
    else by.set(t, [m])
  }
  const cats: MarketCategory[] = []
  for (const [type, ms] of by) {
    cats.push({ type, models: ms, count: ms.length, available: ms.filter((m) => m.available).length })
  }
  return cats.sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a.type)
    const ib = TYPE_ORDER.indexOf(b.type)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.type.localeCompare(b.type)
  })
}

/**
 * The FEATURED shelf — the catalog's editorially-highlighted models
 * (`featured === true`). When the feed marks none, fall back to the cheapest
 * AVAILABLE priced models so the shelf is never empty on a populated catalog —
 * still real listings, never fabricated. Capped at `limit`.
 */
export function featured(models: CatalogEntry[], limit = 6): CatalogEntry[] {
  const flagged = models.filter((m) => m.featured === true)
  if (flagged.length > 0) return flagged.slice(0, limit)
  const priced = models
    .filter((m) => m.available && typeof m.pricing?.input === 'number')
    .sort((a, b) => (a.pricing?.input ?? Infinity) - (b.pricing?.input ?? Infinity))
  return priced.slice(0, limit)
}

/**
 * Apply the storefront filters: a plain text query (safe substring match, never
 * interpreted as HTML or regex), an optional category (modality), and an
 * available-only toggle. Returns the filtered listings unchanged in order.
 */
export function applyFilters(
  models: CatalogEntry[],
  opts: { query?: string; category?: string | null; availableOnly?: boolean },
): CatalogEntry[] {
  const q = opts.query ?? ''
  const cat = opts.category ?? null
  return models.filter(
    (m) =>
      matchesQuery(m, q) &&
      (cat ? modelType(m) === cat : true) &&
      (opts.availableOnly ? m.available : true),
  )
}

/** Storefront summary stats over a set of listings (all real, honest '—' upstream). */
export function marketStats(models: CatalogEntry[]): {
  listings: number
  providers: number
  available: number
  categories: number
} {
  const providers = new Set(models.map((m) => displayProvider(m.provider)))
  const categories = new Set(models.map((m) => modelType(m)))
  return {
    listings: models.length,
    providers: providers.size,
    available: models.filter((m) => m.available).length,
    categories: categories.size,
  }
}

/** A short, human vendor+name label for a listing card (real fields only). */
export function listingTitle(m: CatalogEntry): string {
  return modelDisplayName(m)
}

/** The context reach of a listing in tokens, or null (never fabricated). */
export const listingContext = (m: CatalogEntry): number | null => modelContext(m)
