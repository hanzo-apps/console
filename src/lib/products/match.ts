/**
 * Resolve a URL path under a product module to a route + params, against the live
 * registry. The matching ALGORITHM is the pure `resolveRoute` (tested in
 * match-core.test.ts); this binds it to the real `productModules`.
 *
 * Slug `['providers']` -> module 'providers', its '' route.
 * Slug `['providers', 'openai']` -> module 'providers', its ':name' route with
 * params `{ name: 'openai' }`.
 */
import { productModules } from './registry'
import { resolveRoute, type Matched } from './match-core'

export type { Matched }

export function matchRoute(slug: string[]): Matched | null {
  return resolveRoute(productModules, slug)
}
