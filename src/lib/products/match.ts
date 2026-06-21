/**
 * Resolve a URL path under a product module to a route + params.
 *
 * Slug `['providers']` -> module 'providers', its '' route.
 * Slug `['providers', 'openai']` -> module 'providers', its ':name' route with
 * params `{ name: 'openai' }`.
 *
 * Route patterns are simple segment lists; a `:param` segment captures one value.
 * This is all the matching the registry needs — no regex framework.
 */
import { findModule, type ProductModule, type ProductRoute } from './registry'

export type Matched = {
  module: ProductModule
  route: ProductRoute
  params: Record<string, string>
}

export function matchRoute(slug: string[]): Matched | null {
  const [id, ...rest] = slug
  if (!id) return null
  const module = findModule(id)
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
