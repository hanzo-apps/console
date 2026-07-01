/**
 * Pure catalog matching — routing + filtering, with NO runtime registry import
 * (types only, erased by the compiler). Kept separate from `match.ts`/`search.ts`
 * (which bind these to the real `productModules`/`catalog`) so the logic is unit-
 * testable in a plain-node test without pulling the GUI component tree.
 */
import type { CatalogEntry, ProductModule, ProductRoute, ProductSubpage } from './registry'

export type Matched = {
  module: ProductModule
  route: ProductRoute
  params: Record<string, string>
}

/**
 * Resolve a URL slug against a module list to a route + params. Patterns are
 * segment lists; a `:param` segment captures one value. Routes are tried in order
 * and matched by exact segment count, so `''` (index), `:tab`, and `routing/:name`
 * are unambiguous (e.g. `/models` → index, `/models/routing` → `:tab='routing'`,
 * `/models/routing/new` → `routing/:name` with `name='new'`).
 */
export function resolveRoute(modules: ProductModule[], slug: string[]): Matched | null {
  const [id, ...rest] = slug
  if (!id) return null
  const module = modules.find((m) => m.id === id)
  if (!module) return null

  for (const route of module.routes) {
    const pattern = route.path === '' ? [] : route.path.split('/')
    if (pattern.length !== rest.length) continue

    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pattern.length; i++) {
      const seg = pattern[i]
      const val = rest[i]
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = val
      } else if (seg !== val) {
        ok = false
        break
      }
    }
    if (ok) return { module, route, params }
  }
  return null
}

/**
 * Boolean filter for the sidebar: does an entry contain the query across its
 * label/id/category/gcp/description? Empty query → true (everything shows). Unlike
 * `searchCatalog` (which RANKS into a flat list), the sidebar keeps its category
 * grouping and just needs a per-entry predicate.
 */
export function entryMatches(e: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${e.label} ${e.id} ${e.category} ${e.gcp ?? ''} ${e.description}`.toLowerCase().includes(q)
}

// ── Sub-pages (the level-2 nav contract) ─────────────────────────────────────

/** The product index — the implicit Overview sub-page (never declared). */
export const OVERVIEW_SUBPAGE: ProductSubpage = { slug: '', label: 'Overview' }

/**
 * The uniform base sub-page set every product gets, in exact order, so no
 * product is a snowflake. Overview ('') is prepended separately; a product's own
 * declared specific that owns one of these slugs takes precedence (deduped).
 */
export const BASE_SUBPAGES: ProductSubpage[] = [
  { slug: 'settings', label: 'Settings' },
  { slug: 'status', label: 'Status' },
  { slug: 'logs', label: 'Logs' },
  { slug: 'metrics', label: 'Metrics' },
]

/**
 * The full ordered level-2 nav for a product: Overview, then its declared
 * SPECIFIC sub-pages, then the uniform base set (a base slug the product already
 * declares as a specific is not duplicated). Non-module entries have none.
 *
 * `showAdmin` gates admin-only specifics (e.g. Models › Routing): a customer
 * never sees them in the sub-nav (default true keeps every existing caller
 * showing everything).
 */
export function productSubpages(entry: CatalogEntry, showAdmin = true): ProductSubpage[] {
  if (entry.kind !== 'module') return []
  const specifics = (entry.subpages ?? []).filter((s) => s.slug !== '' && (showAdmin || !s.admin))
  const seen = new Set(specifics.map((s) => s.slug))
  const out: ProductSubpage[] = [OVERVIEW_SUBPAGE, ...specifics]
  for (const b of BASE_SUBPAGES) if (!seen.has(b.slug)) out.push(b)
  return out
}

/**
 * Whether a product URL targets an ADMIN-only view — the product itself is
 * admin-gated, or the trailing segment is an admin-only sub-page. The catch-all
 * uses this (with the client admin signal) to render an honest "managed by
 * Hanzo" notice for a customer instead of letting the module throw a 403.
 */
export function isAdminView(catalog: CatalogEntry[], slug: string[]): boolean {
  const entry = catalog.find((e) => e.id === slug[0])
  if (!entry || entry.kind !== 'module') return false
  if (entry.admin) return true
  const seg = slug[1]
  if (!seg) return false
  return Boolean((entry.subpages ?? []).find((s) => s.slug === seg)?.admin)
}

// ── Command-palette destinations (⌘K jumps to any level) ─────────────────────

/**
 * A command-palette jump target: a product, or a specific sub-page within one
 * (e.g. Compute › Tasks › Queues). Only DECLARED specific sub-pages are indexed
 * (real jump targets); the uniform base placeholders have no content to jump to.
 */
export type Destination =
  | { kind: 'product'; entry: CatalogEntry }
  | { kind: 'subpage'; entry: CatalogEntry; subpage: ProductSubpage; path: string }

/**
 * Every ⌘K jump target — products (catalog order), then each product's declared
 * specific sub-pages. `showAdmin` gates admin products AND admin sub-pages so a
 * customer can't jump to a surface they can't see. Pure (takes the catalog), so
 * the indexing + gating is unit-testable without the GUI tree.
 */
export function destinationsFor(catalog: CatalogEntry[], showAdmin: boolean): Destination[] {
  const products = showAdmin ? catalog : catalog.filter((e) => !e.admin)
  const out: Destination[] = products.map((entry) => ({ kind: 'product', entry }))
  for (const entry of products) {
    if (entry.kind !== 'module') continue
    for (const sp of entry.subpages ?? []) {
      if (sp.slug === '' || (!showAdmin && sp.admin)) continue
      out.push({ kind: 'subpage', entry, subpage: sp, path: `/${entry.id}/${sp.slug}` })
    }
  }
  return out
}

/**
 * True when a sub-page renders a REAL module route (vs. an honest placeholder
 * stub). Derived from the ONE router (`resolveRoute`): `''` → the index, a
 * declared specific on a `:tab` module → the module, an unrouted declared
 * sub-page (module not merged yet) or an undeclared base slug on a single-screen
 * product → NOT wired (the catch-all renders the stub). One source of truth, so
 * the nav's "placeholder" hint and the actual render can never disagree.
 */
export function subpageIsWired(modules: ProductModule[], id: string, slug: string): boolean {
  return resolveRoute(modules, slug === '' ? [id] : [id, ...slug.split('/')]) !== null
}

/** What the catch-all renders for a product URL: a real route, an honest stub, or 404. */
export type ProductView =
  | { kind: 'route'; matched: Matched }
  | { kind: 'stub'; entry: CatalogEntry; subpage: ProductSubpage }
  | { kind: 'notfound' }

/**
 * Resolve a product URL to a view. A real route wins (unchanged behavior — ZERO
 * regression). When no route matches AND the trailing segment is a known
 * sub-page (a declared specific OR a uniform base slug) of a real module
 * product, render an HONEST stub instead of a 404 — so every declared sub-page
 * and every base sub-page resolves to something truthful, never a dead link and
 * never a fabricated surface.
 */
export function resolveProductView(
  catalog: CatalogEntry[],
  modules: ProductModule[],
  slug: string[],
): ProductView {
  const matched = resolveRoute(modules, slug)
  if (matched) return { kind: 'route', matched }
  if (slug.length === 2) {
    const entry = catalog.find((e) => e.id === slug[0])
    if (entry && entry.kind === 'module') {
      const seg = slug[1]
      const declared = (entry.subpages ?? []).find((s) => s.slug === seg)
      const base = BASE_SUBPAGES.find((s) => s.slug === seg)
      const sp = declared ?? base
      if (sp) return { kind: 'stub', entry, subpage: sp }
    }
  }
  return { kind: 'notfound' }
}
