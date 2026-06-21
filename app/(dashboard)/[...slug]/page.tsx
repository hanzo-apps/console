'use client'

import { use } from 'react'
import { notFound } from 'next/navigation'

import { matchRoute } from '~/lib/products/match'

/**
 * Catch-all product route. Resolves the module + route from the registry and
 * renders its component. Adding a product anywhere in the registry makes its
 * routes live here — no per-product page files.
 */
export default function ProductPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params)
  const matched = matchRoute(slug)
  if (!matched) notFound()

  const Component = matched.route.component
  return <Component params={matched.params} />
}
