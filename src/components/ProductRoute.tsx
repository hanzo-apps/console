'use client'

/**
 * The ONE product-route renderer. Resolves the ADDRESS against the registry and
 * renders the module (or an honest sub-page stub / admin notice / interstitial),
 * inside the product error boundary. Mounted by the `app/(dashboard)/[...slug]`
 * catch-all and by the dashboard home (`app/(dashboard)/page.tsx`), because the
 * STATIC bundle serves one index.html for every path and the home is what the
 * browser actually loaded for a deep link.
 *
 * It reads `usePathname()` rather than taking a slug, and that is load-bearing rather
 * than tidy. Navigation carries the address on the history API (see `~/lib/router`),
 * which changes the URL WITHOUT changing the Next route — so a route param is a
 * snapshot of the address the document was loaded with, and would keep rendering the
 * screen you came from. One reader of one source: the URL.
 */
import { usePathname } from 'next/navigation'

import { resolveView, admits, slugOf } from '~/lib/products/match'
import { findEntry } from '~/lib/products/registry'
import { useViewer } from '~/lib/products/viewer'
import { stageOf } from '~/lib/products/stage'
import { ProductSubpageStub } from '~/components/products/ProductSubpageStub'
import { ProductSubpageModule } from '~/components/products/subpage/ProductSubpageModule'
import { ProductInterstitial } from '~/components/products/ProductInterstitial'
import { AdminManagedNotice } from '~/components/products/AdminManagedNotice'
import { ProductErrorBoundary } from '~/components/errors/ProductErrorBoundary'
import { NotFound } from '~/components/NotFound'

export function ProductRoute() {
  const viewer = useViewer()
  const slug = slugOf(usePathname() ?? '')
  const view = resolveView(slug)

  // Rendered, not Next's `notFound()`: the production console IS the static embed,
  // where the cloud binary answers every path with the same index.html — there is no
  // server render to carry a 404 status, and the throw would only trade the shell for
  // a bare page with no way back. Rendering keeps the sidebar (and the way out) and
  // behaves identically on both topologies, which is the point of one renderer.
  if (view.kind === 'notfound') return <NotFound slug={slug} />

  if (view.kind === 'external') return <ProductInterstitial id={view.entry.id} />

  // Hiding is a nav decision, so this is NOT where a beta or alpha product turns
  // into a dead end: `admits` withholds only the `admin` stage — the one backed by
  // org membership the server enforces too — and everything else resolves at its
  // own address for anyone who has it.
  if (!admits(slug, viewer)) {
    const entry = findEntry(slug[0])
    if (entry && entry.kind === 'module') {
      const seg = slug[1]
      const subpage = seg
        ? (entry.subpages ?? []).find((s) => s.slug === seg && stageOf(s) === 'admin')
        : undefined
      return <AdminManagedNotice entry={entry} subpage={subpage} />
    }
  }

  if (view.kind === 'stub') return <ProductSubpageStub entry={view.entry} subpage={view.subpage} />

  if (view.kind === 'subpage')
    return (
      <ProductErrorBoundary resetKey={slug.join('/')}>
        <ProductSubpageModule entry={view.entry} subpage={view.subpage} />
      </ProductErrorBoundary>
    )

  const Component = view.matched.route.component
  return (
    <ProductErrorBoundary resetKey={slug.join('/')}>
      <Component params={view.matched.params} />
    </ProductErrorBoundary>
  )
}

