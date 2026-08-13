'use client'

/**
 * The ONE product-route renderer. Resolves a slug against the registry and renders
 * the module (or an honest sub-page stub / admin notice / interstitial), inside the
 * product error boundary. Used by BOTH the `app/(dashboard)/[...slug]` catch-all
 * (slug from the route params, on a real Next server) AND the dashboard home
 * (`app/(dashboard)/page.tsx`, slug from `usePathname()` — see the note there),
 * so the one-binary STATIC embed resolves deep links client-side from the live URL
 * even though cloud serves the single root `index.html` for every path. One
 * definition, both entry points — no duplicated routing.
 */
import { resolveView, isAdminRoute } from '~/lib/products/match'
import { findEntry } from '~/lib/products/registry'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { ProductSubpageStub } from '~/components/products/ProductSubpageStub'
import { ProductSubpageModule } from '~/components/products/subpage/ProductSubpageModule'
import { ProductInterstitial } from '~/components/products/ProductInterstitial'
import { AdminManagedNotice } from '~/components/products/AdminManagedNotice'
import { ProductErrorBoundary } from '~/components/errors/ProductErrorBoundary'
import { NotFound } from '~/components/NotFound'

export function ProductRoute({ slug }: { slug: string[] }) {
  const showAdmin = useIsSuperAdmin()
  const view = resolveView(slug)

  // Rendered, not Next's `notFound()`: the production console IS the static embed,
  // where the cloud binary answers every path with the same index.html — there is no
  // server render to carry a 404 status, and the throw would only trade the shell for
  // a bare page with no way back. Rendering keeps the sidebar (and the way out) and
  // behaves identically on both topologies, which is the point of one renderer.
  if (view.kind === 'notfound') return <NotFound slug={slug} />

  if (view.kind === 'external') return <ProductInterstitial id={view.entry.id} />

  if (!showAdmin && isAdminRoute(slug)) {
    const entry = findEntry(slug[0])
    if (entry && entry.kind === 'module') {
      const seg = slug[1]
      const subpage = seg ? (entry.subpages ?? []).find((s) => s.slug === seg && s.admin) : undefined
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

