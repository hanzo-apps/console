/**
 * Pure catalog matching — routing + filtering, with NO runtime registry import
 * (types only, erased by the compiler). Kept separate from `match.ts`/`search.ts`
 * (which bind these to the real `productModules`/`catalog`) so the logic is unit-
 * testable in a plain-node test without pulling the GUI component tree.
 */
import type { CatalogEntry, ProductModule, ProductRoute } from './registry'

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
