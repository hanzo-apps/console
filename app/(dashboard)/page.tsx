'use client'

/**
 * Product catalog — the unified console home. Every Hanzo product, grouped by the
 * ten canonical categories, with its Google Cloud equivalent. Every product is
 * open-for-all: each card opens straight into its native in-console surface and
 * carries a "Learn more" affordance to its docs — there is no enablement gate and
 * no external bounce. Each card can be pinned to the sidebar (persisted to the
 * account). Rendered entirely from the catalog registry.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Star, Lock, ArrowRight, BookOpen, KeyRound } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { visibleCatalogByCategory, categorySlug, type CatalogEntry } from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { useIsGlobalAdmin } from '~/lib/auth/admin'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FadeIn } from '~/components/ui/FadeIn'
import { livingOverviewModule } from '~/components/products/overview/living/LivingOverviewModule'
import { ResourceOverview } from '~/components/products/overview/ResourceOverview'

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

/**
 * Prominent, always-visible "Get API key" call-to-action at the top of the home.
 * A cold customer must reach "New key" in one obvious click from landing — the
 * api-keys page is otherwise buried in the collapsed Dev nav group. Routes to the
 * real ApiKeysModule (`/api-keys`), where the `hk-` key is created/copied/rotated.
 */
function GetApiKeyCta({ onOpen }: { onOpen: () => void }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color2" p="$4">
      <XStack items="center" justify="space-between" gap="$4" flexWrap="wrap">
        <XStack items="center" gap="$3" flex={1} minW={240}>
          <YStack bg="$color5" rounded="$4" p="$2.5" items="center" justify="center">
            <KeyRound size={20} />
          </YStack>
          <YStack flex={1} minW={180}>
            <Text fontSize="$5" fontWeight="800">
              Get your API key
            </Text>
            <Text fontSize="$3" color="$color11">
              Call {config.brandName} models from your apps, SDKs, and CLI with a personal key.
            </Text>
          </YStack>
        </XStack>
        <PrimaryButton size="$4" iconAfter={<ArrowRight size={16} />} onPress={onOpen}>
          Get API key
        </PrimaryButton>
      </XStack>
    </Card>
  )
}

export default function DashboardHome() {
  const router = useRouter()
  const { toggle, isPinned } = useFavorites()
  const showAdmin = useIsGlobalAdmin()
  const push = (path: string) => router.push(path)
  const groups = visibleCatalogByCategory(showAdmin)

  // Billing-only shell (billing.<brand> / NEXT_PUBLIC_BILLING_ONLY): the default
  // route IS the Billing Center — redirect the catalog home to the billing overview
  // so people who only ever see billing.hanzo.ai land straight on billing.
  useEffect(() => {
    if (config.billingOnly) router.replace('/billing')
  }, [router])
  if (config.billingOnly) {
    return (
      <XStack flex={1} justify="center" items="center" p="$8">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }

  return (
    <YStack gap="$7">
      <GetApiKeyCta onOpen={() => push('/api-keys')} />
      <OverviewDashboard params={{}} />
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
