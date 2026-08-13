'use client'

/**
 * ProductGuidePanel — the ONE place a product's pitch + getting-started panel is
 * mounted. Rendered once at the top of the console content column (DashboardShell),
 * it resolves the current product from the path and, when that product has a curated
 * guide, renders {@link PitchHero}. Everywhere else it renders nothing — the long
 * tail keeps its own native overview / admin surface (no generic nagging).
 *
 * It also records honest landing telemetry for EVERY product (not only guided ones):
 * being on a product's landing is a real "you've opened it" fact, which is what lets
 * other guides' steps check themselves off (e.g. the console guide's "try it in the
 * Playground" ticks once you have actually opened the Playground).
 *
 * Two mount shapes: `pathname` (product landing, resolved to a canonical id) or an
 * explicit `guideId` (the console home passes `overview`). The empty path IS the home.
 */
import { useEffect } from 'react'

import { matchRoute } from '~/lib/products/match'
import { resolveGuide } from '~/lib/guide/registry'
import { useMarkUsed } from '~/lib/guide/use-signals'
import { PitchHero } from './PitchHero'

/** Canonical product id for a path — but ONLY on the product's landing route. */
export function landingProductId(pathname?: string): string | undefined {
  if (!pathname) return undefined
  const segs = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  // The console HOME leads with the account's own board — credits, spend, caching,
  // the model lineup — not a pitch. A signed-in account has already been sold to;
  // stacking "what Hanzo is" above what it currently HAS pushes the real state of
  // the account below the fold. The pitch still leads every product landing, which
  // is the surface where a reader genuinely has not met the product yet.
  if (segs.length === 0) return undefined
  if (segs.length !== 1) return undefined // the pitch leads the landing only, not sub-pages
  return matchRoute(segs)?.module.id
}

export function ProductGuidePanel({ pathname, guideId }: { pathname?: string; guideId?: string }) {
  const markUsed = useMarkUsed()
  const id = guideId ?? landingProductId(pathname)

  useEffect(() => {
    if (id) markUsed(id)
  }, [id, markUsed])

  if (!id) return null
  const guide = resolveGuide(id)
  if (!guide) return null
  return <PitchHero guide={guide} />
}
