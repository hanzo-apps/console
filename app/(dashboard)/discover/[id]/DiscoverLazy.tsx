'use client'

import dynamic from 'next/dynamic'

// GUI-free at module scope; the interstitial (GUI) loads client-only via ssr:false.
const Inner = dynamic(
  () => import('~/components/products/ProductInterstitial').then((m) => m.ProductInterstitial),
  { ssr: false },
)

export function DiscoverLazy({ id }: { id: string }) {
  return <Inner id={id} />
}
