'use client'

import { use } from 'react'

import { ProductRoute } from '~/components/ProductRoute'

/**
 * Catch-all product route. Resolves the module + route from the registry and
 * renders its component via the shared `ProductRoute` (the ONE renderer, also used
 * by the dashboard home for the static embed). Adding a product anywhere in the
 * registry makes its routes live here — no per-product page files.
 *
 * `ProductRoute` applies the two honest gates (sub-page stub, admin "managed by
 * Hanzo" notice), the external-product interstitial, and the per-route error
 * boundary. See that component.
 */
export default function ProductPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params)
  return <ProductRoute slug={slug} />
}
