'use client'

/**
 * Product catalog — the unified console home. Every Hanzo product, grouped by the
 * ten canonical categories, with its Google Cloud equivalent. Every product is
 * open-for-all: each card opens straight into its native in-console surface and
 * carries a "Learn more" affordance to its docs — there is no enablement gate and
 * no external bounce. Each card can be pinned to the sidebar (persisted to the
 * account). Rendered entirely from the catalog registry.
 */
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Star, Lock, ArrowRight, BookOpen } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { shellFor } from '~/lib/products/shell'
import { visibleCatalogByCategory, categorySlug, type CatalogEntry } from '~/lib/products/registry'
import { resolveView } from '~/lib/products/match'
import { ProductRoute } from '~/components/ProductRoute'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { PageHeader } from '~/components/ui/PageHeader'
import { FadeIn } from '~/components/ui/FadeIn'
import { livingOverviewModule } from '~/components/products/overview/living/LivingOverviewModule'
import { ResourceOverview } from '~/components/products/overview/ResourceOverview'
import { ProductObservability } from '~/components/products/observability/ProductObservability'

// The home centerpiece is the reusable LivingOverview (count-up KPIs, live
// sparklines, streaming activity) — the SAME component every product overview uses.
const OverviewDashboard = livingOverviewModule('overview')

function ProductCard({
  entry,
  pinned,
  onOpen,
  onToggle,
  onLearnMore,
}: {
  entry: CatalogEntry
  pinned: boolean
  onOpen: () => void
  onToggle: () => void
  onLearnMore: () => void
}) {
  const Icon = entry.icon
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" width={272}>
      <XStack justify="space-between" items="flex-start">
        <XStack gap="$2" items="center" flex={1}>
          <Icon size={20} />
          <YStack flex={1}>
            <Text fontSize="$5" fontWeight="700">
              {entry.label}
            </Text>
            {entry.gcp ? (
              <Text fontSize="$1" color="$color10">
                {entry.gcp}
              </Text>
            ) : null}
          </YStack>
        </XStack>
        <XStack gap="$1" items="center">
          {entry.admin ? <Lock size={13} opacity={0.45} /> : null}
          <Button
            size="$2"
            chromeless
            opacity={pinned ? 1 : 0.3}
            icon={<Star size={15} />}
            onPress={onToggle}
            aria-label={pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
          />
        </XStack>
      </XStack>

      <Text fontSize="$3" color="$color11" minH={40}>
        {entry.description}
      </Text>

      <XStack justify="space-between" items="center">
        <Button
          size="$2"
          chromeless
          icon={<BookOpen size={14} />}
          onPress={onLearnMore}
          aria-label={`Learn more about ${entry.label}`}
        >
          Learn more
        </Button>
        <Button
          size="$2"
          bg="$color5"
          borderWidth={1}
          borderColor="$borderColor"
          onPress={onOpen}
          iconAfter={<ArrowRight size={14} />}
        >
          Open
        </Button>
      </XStack>
    </Card>
  )
}

export default function DashboardHome() {
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const { toggle, isPinned } = useFavorites()
  const showAdmin = useIsSuperAdmin()
  const push = (path: string) => router.push(path)
  const groups = visibleCatalogByCategory(showAdmin)

  useEffect(() => setMounted(true), [])

  // Product-shell face (billing.<brand> / sentry.<brand> / an override): the default
  // route IS the face's home — redirect the catalog home there so people who only ever
  // see billing.hanzo.ai land on billing, and sentry.hanzo.ai on Issues. ONE redirect
  // for every face, driven by the shell descriptor.
  const shellHome = shellFor(config.shell).home
  useEffect(() => {
    if (shellHome) router.replace(`/${shellHome}`)
  }, [router, shellHome])

  // One-binary STATIC embed: cloud serves THIS page's index.html for EVERY deep
  // link (a static export can't pre-generate arbitrary product slugs), so a direct
  // load / refresh — or a client nav that hard-falls-back — of /models, /chat,
  // /tracker … would otherwise render the home instead of the module. Resolve the
  // LIVE path client-side and hand any real product route to the shared
  // ProductRoute. Gated on `mounted` so the first client render matches the
  // server-exported home ("/") — no hydration mismatch; it then swaps to the
  // resolved module. On a real Next server this page only renders for "/", so
  // `segments` is empty and the home always shows; an unknown/non-product deep path
  // (e.g. /category/*, /discover/*) resolves to notfound here and falls through to
  // the home rather than a hard 404 in the embed.
  const segments =
    mounted && pathname ? pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean) : []
  if (segments.length > 0 && resolveView(segments).kind !== 'notfound') {
    return <ProductRoute slug={segments} />
  }

  if (shellHome) {
    return (
      <XStack flex={1} justify="center" items="center" p="$8">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }

  return (
    <YStack gap="$7">
      <OverviewDashboard params={{}} />

      {/* Observability, front-and-center — the platform's live LLM signals (RED
          metrics · recent logs · recent traces) on the home, the way Langfuse put
          its metrics dashboard up top. Reuses the ONE shared ProductObservability
          panel over the `ai` inference service (honest-empty until o11y emits), and
          deep-links to the full Observe surface. `data-tour` anchors the first-run
          tour's Observability step. */}
      <YStack gap="$3" data-tour="metrics">
        <XStack
          self="flex-start"
          items="center"
          gap="$2"
          cursor="pointer"
          hoverStyle={{ opacity: 0.75 }}
          onPress={() => push('/o11y')}
          aria-label="Open Observability"
        >
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Observability
          </Text>
          <ArrowRight size={16} opacity={0.5} />
        </XStack>
        <ProductObservability service="ai" label="AI inference" />
      </YStack>

      <ResourceOverview />
      <YStack gap="$4">
        <PageHeader
          title="Explore products"
          subtitle={`Open and manage every ${config.brandName} product from one place.`}
        />
        {groups.map((group, i) => (
        <FadeIn key={group.category} index={i} style={{ width: '100%' }}>
          <YStack gap="$3">
            <XStack
              self="flex-start"
              items="center"
              gap="$2"
              cursor="pointer"
              hoverStyle={{ opacity: 0.75 }}
              onPress={() => push(`/category/${categorySlug(group.category)}`)}
              aria-label={`${group.category} overview`}
            >
              <Text fontSize="$5" fontWeight="800" color="$color12">
                {group.category}
              </Text>
              <ArrowRight size={16} opacity={0.5} />
            </XStack>
            <XStack flexWrap="wrap" gap="$3">
              {group.entries.map((entry) => (
                <ProductCard
                  key={entry.id}
                  entry={entry}
                  pinned={isPinned(entry.id)}
                  onOpen={() => openProduct(entry, push)}
                  onToggle={() => toggle(entry.id)}
                  onLearnMore={() => push(`/discover/${entry.id}`)}
                />
              ))}
            </XStack>
          </YStack>
        </FadeIn>
        ))}
      </YStack>
    </YStack>
  )
}
