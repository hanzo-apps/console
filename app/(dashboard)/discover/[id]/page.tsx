'use client'

import { use } from 'react'

import { ProductInterstitial } from '~/components/products/ProductInterstitial'

/**
 * Product discover screen — `/discover/<id>` renders the interstitial for one
 * catalog entry (docs, OSS source, revenue share, open/get-started). A dedicated
 * route (more specific than the `[...slug]` product catch-all) so it's shareable.
 */
export default function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <ProductInterstitial id={id} />
}
