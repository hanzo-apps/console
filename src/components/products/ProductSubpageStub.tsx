'use client'

/**
 * Honest sub-page placeholder — the ONE surface for a level-2 sub-page that is
 * part of a product's uniform nav (Overview · Settings · Status · Logs ·
 * Metrics) or a declared specific whose module/route isn't merged yet.
 *
 * It is NOT a 404 and NOT fabricated data: it names the product + sub-page,
 * states plainly that the surface isn't wired to a backend on this deployment
 * yet, and offers the one honest next step (back to the product, or the docs).
 * Rendered by the catch-all when `resolveView` returns a `stub`, so every
 * declared and base sub-page resolves to something truthful.
 */
import { useRouter } from 'next/navigation'

import type { CatalogEntry, ProductSubpage } from '~/lib/products/registry'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { FadeIn } from '~/components/ui/FadeIn'

/** Truthful, per-base-slug guidance; a declared specific falls back to a generic. */
const BASE_BLURB: Record<string, string> = {
  settings: 'Configuration for this product appears here once its settings surface is wired.',
  status: 'Live health and availability for this product appears here once its status feed is wired.',
  logs: 'Structured logs for this product stream here once its log source is wired.',
  metrics: 'Usage and performance metrics for this product render here once its metrics feed is wired.',
}

export function ProductSubpageStub({
  entry,
  subpage,
}: {
  entry: CatalogEntry
  subpage: ProductSubpage
}) {
  const router = useRouter()
  const blurb =
    BASE_BLURB[subpage.slug] ??
    `${subpage.label} for ${entry.label} is on the roadmap — it appears here automatically once the backend is wired.`
  const docs = entry.docs ?? config.docsUrl

  return (
    <>
      <PageHeader title={`${entry.label} · ${subpage.label}`} subtitle={entry.description} />
      <FadeIn style={{ width: '100%' }}>
        <EmptyState
          icon={entry.icon}
          title={`${subpage.label} isn’t available yet`}
          description={blurb}
          bullets={[
            'Nothing is fabricated — this page stays empty until the real backend is connected.',
            `${subpage.label} shows up here the moment ${entry.label} exposes it.`,
          ]}
          primary={{ label: `Open ${entry.label}`, onPress: () => router.push(`/${entry.id}`) }}
          secondary={{ label: 'Docs', href: docs }}
        />
      </FadeIn>
    </>
  )
}
