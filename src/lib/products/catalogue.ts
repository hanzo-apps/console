/**
 * Joining the taxonomy SERVICE to the registry in this bundle.
 *
 * The catalogue was one array and is now two halves that meet here, because only
 * one of them was ever data:
 *
 *   • the service owns what a person MAINTAINS — a product's name, its one-line
 *     description, which category it sits in, its tags, its position, whether it
 *     is published, and whose it is. Editing any of these was a commit, a review
 *     and a deploy; now it is a PUT.
 *   • this bundle owns what a person COMPILES — the React route components a
 *     product renders through, its sub-pages, the icon COMPONENT a name resolves
 *     to, and the fields not yet migrated (repo, docs, gcp, admin, indexLabel,
 *     shell). None of that can arrive over a wire, so none of it is asked for.
 *
 * ONE RULE DECIDES WHAT IS SHOWN: the catalogue is what this console can OPEN. An
 * entry is renderable when this build has code for it, or when it is a launch
 * tile that opens someone else's domain (`href`). A taxon that names an
 * in-console `route` this build has no module for is NOT rendered — a nav item
 * leading to a 404 is worse than one that is absent, and it is exactly what a
 * catalogue naming a product this console has not shipped would produce.
 *
 * That rule also settles the two disagreements a live migration guarantees:
 *
 *   • a row this bundle has and the service does not (the service's copy is
 *     older, or the product is new here) keeps rendering, from its local
 *     presentation. The taxonomy describes products; it does not uninstall them.
 *   • a CATEGORY the service files a product under that this build does not know
 *     (a grouping retired here but not yet there) falls back to the local
 *     category. A product is never left homeless by a name this build cannot
 *     resolve, and a retired grouping cannot come back through the wire.
 *
 * Pure and dependency-free — no React, no registry import — for the reason
 * `brand-scope.ts` is: the registry cannot be loaded in vitest at all (icon ESM),
 * so the join is proved here over plain data and the React layer only supplies
 * it.
 */
import type { Taxon } from '~/lib/api/taxonomy'

/** The org that owns the PLATFORM catalogue — the rows every tenant sees. */
export const PLATFORM_ORG = 'hanzo'

/**
 * What the join needs from a compiled entry. A structural subset of the
 * registry's `CatalogEntry`, so the real one satisfies it without a cast and this
 * module still never imports it.
 */
export type Local<C extends string> = {
  id: string
  label: string
  description: string
  category: C
  brands?: readonly string[]
}

/** One product, after the two halves have met. */
export type Joined<C extends string, E extends Local<C>> = {
  /** The compiled entry — the icon, the routes, the sub-pages, the unmigrated fields. */
  entry: E
  /** Display name: the service's, falling back to what was compiled. */
  label: string
  /** Display description: same rule. */
  description: string
  /** Where it sits, resolved to a category THIS build knows. */
  category: C
  /** Free-form labels, from the service. Empty when it has no row for this. */
  tags: readonly string[]
  /**
   * The org whose row this is, or null when the service carried none. It is how a
   * console decides EDITABILITY without a second call: `editable` below.
   */
  owner: string | null
}

/**
 * Whether this org may edit the row behind a product. Platform rows belong to
 * `hanzo` and answer to a SuperAdmin; an org edits its own. A product the service
 * does not carry has no row to edit at all.
 *
 * This reads the `owner` the READ already returned, which is the point of the
 * field: the alternative is asking the service who owns each row, one call per
 * row, to render a pencil icon.
 */
export const editable = (owner: string | null, org: string | null): boolean =>
  owner !== null && org !== null && owner === org

/**
 * Join the service's rows onto the compiled entries.
 *
 * `taxa` is every taxon the service returned, already brand-narrowed and
 * tenancy-resolved by it (`?brand=`, platform + own org, caller's row winning a
 * shared id) — this does not filter again. `known` resolves a category id the
 * service uses onto one this build has, and returns null for one it does not.
 */
export function join<C extends string, E extends Local<C>>(
  taxa: readonly Taxon[],
  entries: readonly E[],
  known: (categoryId: string) => C | null,
): Joined<C, E>[] {
  const compiled = new Map(entries.map((e) => [e.id, e]))
  const out: Joined<C, E>[] = []
  const placed = new Set<string>()

  // The service's order is the catalogue's order, so its rows lead.
  for (const t of taxa) {
    const entry = compiled.get(t.id)
    // Nothing this console can open: no module compiled for it. A row naming a
    // product this build has not shipped renders nowhere, which is the honest
    // outcome — the alternative is a nav item that leads to a 404.
    if (!entry) continue
    placed.add(t.id)
    out.push({
      entry,
      label: t.name || entry.label,
      description: t.description || entry.description,
      category: known(t.category) ?? entry.category,
      tags: t.tags ?? [],
      owner: t.owner,
    })
  }

  // Anything compiled that the service did not carry still renders, from what was
  // compiled. This is the older-service case, and it is why a stale catalogue
  // cannot take a working product off the nav.
  for (const e of entries) {
    if (placed.has(e.id)) continue
    out.push({
      entry: e,
      label: e.label,
      description: e.description,
      category: e.category,
      tags: [],
      owner: null,
    })
  }
  return out
}

/** The join, grouped into sections in the order given, skipping empty ones. */
export function group<C extends string, E extends Local<C>>(
  joined: readonly Joined<C, E>[],
  order: readonly C[],
): { category: C; entries: Joined<C, E>[] }[] {
  return order
    .map((category) => ({ category, entries: joined.filter((j) => j.category === category) }))
    .filter((g) => g.entries.length > 0)
}
