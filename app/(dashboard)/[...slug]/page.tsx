'use client'

import { use } from 'react'
import { notFound } from 'next/navigation'

import { resolveView, isAdminRoute } from '~/lib/products/match'
import { findEntry } from '~/lib/products/registry'
import { useIsGlobalAdmin } from '~/lib/auth/admin'
import { ProductSubpageStub } from '~/components/products/ProductSubpageStub'
import { ProductSubpageModule } from '~/components/products/subpage/ProductSubpageModule'
import { ProductInterstitial } from '~/components/products/ProductInterstitial'
import { AdminManagedNotice } from '~/components/products/AdminManagedNotice'
import { ProductErrorBoundary } from '~/components/errors/ProductErrorBoundary'

/**
 * Catch-all product route. Resolves the module + route from the registry and
 * renders its component. Adding a product anywhere in the registry makes its
 * routes live here — no per-product page files.
 *
 * Two honest gates on top of the resolver:
 * - A known product SUB-PAGE (a declared specific or a uniform base sub-page:
 *   Overview · Settings · Status · Logs · Metrics) with no backend route yet
 *   renders a placeholder stub — never a 404, never a fabricated surface.
 * - A CUSTOMER (non-global-admin) reaching an admin-only surface (cross-tenant
 *   IAM/KMS, provider + routing config) gets a graceful "managed by Hanzo" notice
 *   instead of the module's hostile 403 red error. Access is enforced
 *   server-side regardless.
 *
 * The resolved module renders inside `ProductErrorBoundary`: modules mount
 * client-only (the authed shell renders a loader during SSR), so a throw in one
 * module's first render had no boundary and white-screened the whole console
 * ("Application error: a client-side exception") on a direct load / refresh. The
 * boundary keeps the shell + nav and shows an honest, retryable card instead —
 * one place, every product route (DRY).
 */
export default function ProductPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params)
  const showAdmin = useIsGlobalAdmin()
  const view = resolveView(slug)

  if (view.kind === 'notfound') notFound()

  // A directly-navigated URL to an EXTERNAL product (its id, or a conventional
  // alias like /automation → auto) — render its in-console discover page (what it
  // is + an "Open" that launches its own domain), never a 404. The nav/launcher
  // launch it directly; this only catches a hand-typed/bookmarked URL.
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

  // A uniform base sub-page (Status/Logs/Metrics/Settings) → the shared per-product
  // sub-page system (real feed or honest state), inside the same error boundary so
  // a data fetch that throws shows the retryable card, never a white screen.
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
