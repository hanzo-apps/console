'use client'

import { ProductRoute } from '~/components/ProductRoute'

/**
 * Catch-all product route. `ProductRoute` reads the live address and resolves the
 * module from the registry, so adding a product anywhere in the registry makes its
 * routes live here — no per-product page files, and no route param to fall out of
 * step with the URL when navigation moves the address without a document load.
 *
 * `ProductRoute` applies the honest gates (sub-page stub, admin "managed by Hanzo"
 * notice), the external-product interstitial, the no-such-page surface, and the
 * per-route error boundary. See that component.
 */
export default function ProductPage() {
  return <ProductRoute />
}
