'use client'

/**
 * Base — the Firebase-like Hanzo Base backend, presented as a Supabase-style
 * dashboard: model your content types (collections) and manage your data, all on
 * your organization's per-org Base.
 *
 * This module is a thin route adapter; the whole surface lives in the reusable
 * `BaseDashboard` (content-types index + the content-type builder + the
 * schema-driven record browse/edit). There is ONE Base binding — console2's OWN
 * `/superbase` proxy, which mints the user's IAM bearer and stamps `X-Org-Id`
 * from the JWT owner, so everything is scoped to this org's Base. We do not
 * reimplement Base; we drive its real `/v1/collections` API through the proxy.
 *
 * Routes (declared in the registry, resolved by segment count):
 *   /base · /base/new · /base/:collection · /base/:collection/:id
 */
import { BaseDashboard } from './base/BaseDashboard'

export function BaseModule({ params }: { params: Record<string, string> }) {
  return <BaseDashboard params={params} />
}

export default BaseModule
