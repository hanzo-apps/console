/**
 * Resolve a URL path under a product module to a route + params, against the live
 * registry. The matching ALGORITHM is the pure `resolveRoute` (tested in
 * match-core.test.ts); this binds it to the real `productModules` + `catalog`.
 *
 * Slug `['providers']` -> module 'providers', its '' route.
 * Slug `['providers', 'openai']` -> module 'providers', its ':name' route with
 * params `{ name: 'openai' }`.
 *
 * `resolveView` is the catch-all's resolver: a real route, an honest sub-page
 * stub (declared/base sub-page with no backend yet), or 404 — never a dead link.
 */
import { catalog, productModules } from './registry'
import {
  resolveRoute,
  resolveProductView,
  productSubpages,
  subpageIsWired,
  isAdminView,
  subpageSlug,
  subpageHref,
  activeSubpage,
  slugOf,
  type Matched,
  type ProductView,
} from './match-core'

export type { Matched, ProductView }
export { productSubpages, subpageHref, activeSubpage, slugOf }

/**
 * The level-2 slug a `:tab` param selects within a product — validated against the
 * ONE registry declaration, so a module and the nav can never disagree about which
 * tab is live. Unknown segment → '' (the index).
 */
export function productSubpageSlug(id: string, seg: string | undefined, showAdmin = true): string {
  const entry = catalog.find((e) => e.id === id)
  return entry ? subpageSlug(entry, seg, showAdmin) : ''
}

export function matchRoute(slug: string[]): Matched | null {
  return resolveRoute(productModules, slug)
}

/** Resolve a product URL to what the catch-all should render. */
export function resolveView(slug: string[]): ProductView {
  return resolveProductView(catalog, productModules, slug)
}

/** True when a product sub-page renders a real route (vs. an honest stub). */
export function subpageWired(id: string, slug: string): boolean {
  return subpageIsWired(productModules, id, slug)
}

/** True when a product URL targets an admin-only (global) view. */
export function isAdminRoute(slug: string[]): boolean {
  return isAdminView(catalog, slug)
}
