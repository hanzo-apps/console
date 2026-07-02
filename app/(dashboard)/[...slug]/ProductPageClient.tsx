'use client'

import { notFound } from 'next/navigation'

import { resolveView, isAdminRoute } from '~/lib/products/match'
import { findEntry } from '~/lib/products/registry'
import { useIsGlobalAdmin } from '~/lib/auth/admin'
import { ProductSubpageStub } from '~/components/products/ProductSubpageStub'
import { AdminManagedNotice } from '~/components/products/AdminManagedNotice'
import { ProductErrorBoundary } from '~/components/errors/ProductErrorBoundary'

/**
 * Catch-all product route (client). Resolves the module + route from the registry
 * and renders its component. Adding a product anywhere in the registry makes its
 * routes live here — no per-product page files.
 *
 * The `slug` is passed in by the server `page.tsx` wrapper (which owns
 * `generateStaticParams` for the static export) — so this stays a pure client
 * component reading only the resolved segments, never `params`.
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
export function ProductPageClient({ slug }: { slug: string[] }) {
  const showAdmin = useIsGlobalAdmin()
  const view = resolveView(slug)

  if (view.kind === 'notfound') notFound()

  if (!showAdmin && isAdminRoute(slug)) {
    const entry = findEntry(slug[0])
    if (entry && entry.kind === 'module') {
      const seg = slug[1]
      const subpage = seg ? (entry.subpages ?? []).find((s) => s.slug === seg && s.admin) : undefined
      return <AdminManagedNotice entry={entry} subpage={subpage} />
    }
  }

  if (view.kind === 'stub') return <ProductSubpageStub entry={view.entry} subpage={view.subpage} />

  const Component = view.matched.route.component
  return (
    <ProductErrorBoundary resetKey={slug.join('/')}>
      <Component params={view.matched.params} />
    </ProductErrorBoundary>
  )
}
