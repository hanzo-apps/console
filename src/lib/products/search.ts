/**
 * Catalog search — rank the product catalog against a query for the command
 * palette. ONE scorer, no dependency: an exact substring beats a subsequence,
 * an earlier/contiguous match beats a scattered one, and fields are weighted
 * (label > id > category/gcp > description). Empty query returns the catalog in
 * its natural order, so the palette can show everything by default.
 */
import { visibleCatalog, type CatalogEntry } from './registry'
import { destinationsFor, type Destination } from './match-core'

// The sidebar's per-entry filter predicate + the destination indexing live in the
// pure core (unit-testable without the GUI tree); re-exported here as the search API.
export { entryMatches } from './match-core'
export type { Destination } from './match-core'

/** Score one field; 0 = no match, higher = better. */
function fuzzy(q: string, text: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx === 0) return 1000
  if (idx > 0) return 600 - Math.min(idx, 100)

  // Subsequence: every char of q appears in order. Reward contiguity + early hits.
  let ti = 0
  let score = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return 0
    streak = found === ti ? streak + 1 : 0
    score += 10 + streak * 5 - Math.min(found - ti, 8)
    ti = found + 1
  }
  return Math.max(score, 1)
}

/** Best weighted field score for an entry. */
function scoreEntry(q: string, e: CatalogEntry): number {
  return Math.max(
    fuzzy(q, e.label) * 3,
    fuzzy(q, e.id) * 2,
    fuzzy(q, e.category),
    fuzzy(q, e.gcp ?? ''),
    fuzzy(q, e.description) * 0.5,
  )
}

/**
 * The catalog ranked for `query`. Empty query → the visible catalog in natural
 * order. Sourced from `visibleCatalog(true)` so brand scope AND billing-only shell
 * mode apply (admin entries are kept for callers to gate) — one scoping rule shared
 * with the sidebar/home, so ⌘K never offers a product the shell hides.
 */
export function searchCatalog(query: string): CatalogEntry[] {
  const scope = visibleCatalog(true)
  const q = query.trim().toLowerCase()
  if (!q) return scope
  return scope
    .map((e) => ({ e, s: scoreEntry(q, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e)
}

// ── Destinations — products AND sub-pages (⌘K jumps to any level) ─────────────
// The indexing + admin gating is the pure `destinationsFor` (unit-tested with
// fixtures in match-core); this binds it to the real catalog + ranks the results.

/** Best weighted score for a destination — a sub-page ranks on its own label
 *  and its "Product › Sub-page" pair, weighted just under the product. */
function scoreDestination(q: string, d: Destination): number {
  if (d.kind === 'product') return scoreEntry(q, d.entry)
  const { entry, subpage } = d
  return Math.max(
    fuzzy(q, subpage.label) * 2.5,
    fuzzy(q, `${entry.label} ${subpage.label}`) * 2,
    fuzzy(q, subpage.slug) * 1.5,
    fuzzy(q, entry.label),
    fuzzy(q, entry.category) * 0.5,
  )
}

/**
 * Rank products AND sub-pages for `query`. Empty query → products only (catalog
 * order), so the palette opens on the familiar product list; typing surfaces
 * deep sub-page jumps ("queues" → Compute › Tasks › Queues). `showAdmin` gates
 * admin-only surfaces so a customer can't jump to what they can't see.
 */
export function searchDestinations(query: string, showAdmin = true, enabled?: string[] | null, showBeta = false): Destination[] {
  const q = query.trim().toLowerCase()
  // Scope to the visible catalog (brand + billing-only shell + entitlements), then
  // gate admin — so ⌘K jumps match exactly what the nav shows (billing-only offers
  // only billing; a customer only what their org has enabled). A TYPED query is
  // DISCOVERY: the entitlement scope opens to the whole catalog — searching is
  // for finding what you do not have yet — while admin and beta keep holding.
  const all = destinationsFor(visibleCatalog(showAdmin, q ? null : enabled, showBeta), showAdmin)
  if (!q) return all.filter((d) => d.kind === 'product')
  return all
    .map((d) => ({ d, s: scoreDestination(q, d) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.d)
}
