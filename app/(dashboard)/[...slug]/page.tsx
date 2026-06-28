'use client'

import { use } from 'react'
import { notFound } from 'next/navigation'

import { matchRoute } from '~/lib/products/match'
import { isAdminProductId } from '~/lib/auth/admin'
import { useSession } from '~/lib/auth/session'
import { ApiError } from '~/lib/api'
import { ErrorState } from '~/components/ui/States'
import { Loader } from '~/components/ui/Loader'

/**
 * Catch-all product route. Resolves the module + route from the registry and
 * renders its component. Adding a product anywhere in the registry makes its
 * routes live here — no per-product page files.
 *
 * Function-level authz: an admin-only product (IAM/KMS/Secrets/Audit/Clusters/
 * Kubernetes) NEVER renders for a non-admin, however the URL was reached — nav
 * hiding is cosmetic, this is the gate. The backend `/v1` endpoints remain the
 * server-side authority (defense in depth); this stops the admin UI from ever
 * mounting (and firing those calls) for a non-admin.
 */
export default function ProductPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params)
  const { account, loading } = useSession()

  const matched = matchRoute(slug)
  if (!matched) notFound()

  if (isAdminProductId(matched.module.id) && !account?.isAdmin) {
    if (loading) return <Loader />
    return <ErrorState err={new ApiError('Admin access is required for this surface.', 403)} />
  }

  const Component = matched.route.component
  return <Component params={matched.params} />
}
