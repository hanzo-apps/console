'use client'

/**
 * Admin-managed notice — the graceful, honest state a CUSTOMER sees if they reach
 * an admin-only surface directly (a deep link or a stale bookmark). Instead of the
 * module's hostile 403 "Not authorized" red error, it explains the surface is
 * managed by the platform administrator, not per organization, and points the way
 * back. Access is always enforced server-side; this is only the friendly UI gate.
 */
import { useRouter } from 'next/navigation'

import type { CatalogEntry, ProductSubpage } from '~/lib/products/registry'
import { config } from '~/config'
import { EmptyState, FadeIn, PageHeader } from '@hanzo/ui/product'

export function AdminManagedNotice({
  entry,
  subpage,
}: {
  entry: CatalogEntry
  subpage?: ProductSubpage
}) {
  const router = useRouter()
  const what = subpage ? `${entry.label} · ${subpage.label}` : entry.label
  return (
    <>
      <PageHeader title={what} subtitle={entry.description} />
      <FadeIn style={{ width: '100%' }}>
        <EmptyState
          icon={entry.icon}
          title="Managed by Hanzo"
          description={`${what} is a platform-managed surface — it's configured by your ${config.brandName} administrator, not per organization. You have full access to everything your organization owns.`}
          bullets={[
            'Nothing is broken — this is intentionally managed at the platform level.',
            'Need a change here? Ask your platform administrator.',
          ]}
          primary={{ label: 'Back to Overview', onPress: () => router.push('/') }}
          secondary={{ label: 'Your API keys', onPress: () => router.push('/api-keys') }}
        />
      </FadeIn>
    </>
  )
}
