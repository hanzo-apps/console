import { PRODUCT_SLUGS } from '~/lib/products/route-slugs'
import { ProductPageLazy } from './ProductPageLazy'

/**
 * Catch-all product route — GUI-free server shell for the static export.
 *
 * The dashboard is a react-native-web GUI SPA that cannot be server-evaluated, so
 * this module imports NOTHING from the product registry: it renders `ProductPageLazy`
 * (which `dynamic(ssr:false)`-loads the registry-backed resolver on the client) and
 * enumerates the top-level product slugs from the GUI-free manifest so `output:
 * 'export'` prerenders one shell per product (`/ai`, `/models`, …). Deeper sub-routes
 * (and any unlisted product) are served the shell `index.html` by the cloud binary's
 * SPA handler (webui.go) and resolved client-side from the URL.
 */
export function generateStaticParams(): { slug: string[] }[] {
  return PRODUCT_SLUGS.map((id) => ({ slug: [id] }))
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  return <ProductPageLazy slug={slug} />
}
