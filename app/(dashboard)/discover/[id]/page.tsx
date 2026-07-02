import { PRODUCT_SLUGS } from '~/lib/products/route-slugs'
import { DiscoverLazy } from './DiscoverLazy'

/**
 * Product discover screen — `/discover/<id>` renders the interstitial for one
 * catalog entry. GUI-free server shell for the static export (see the sibling
 * `[...slug]/page.tsx`): renders the client-only `DiscoverLazy` and enumerates the
 * GUI-free product-slug manifest so no GUI is server-evaluated during prerender.
 * Unlisted ids are served the shell `index.html` and resolved client-side.
 */
export function generateStaticParams(): { id: string }[] {
  return PRODUCT_SLUGS.map((id) => ({ id }))
}

export default async function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DiscoverLazy id={id} />
}
