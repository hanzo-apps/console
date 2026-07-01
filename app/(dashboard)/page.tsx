'use client'

/**
 * Product catalog — the unified console home. Every Hanzo product, grouped by the
 * ten canonical categories, with its Google Cloud equivalent. Every product is
 * open-for-all: each card opens straight into its native in-console surface and
 * carries a "Learn more" affordance to its docs — there is no enablement gate and
 * no external bounce. Each card can be pinned to the sidebar (persisted to the
 * account). Rendered entirely from the catalog registry.
 */
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Star, Lock, ArrowRight, BookOpen } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { catalogByCategory, type CatalogEntry } from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { PageHeader } from '~/components/ui/PageHeader'
import { FadeIn } from '~/components/ui/FadeIn'
import OverviewDashboard from '~/components/products/OverviewModule'

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
  const { toggle, isPinned } = useFavorites()
  const push = (path: string) => router.push(path)
  const groups = catalogByCategory()

  return (
    <YStack gap="$7">
      <OverviewDashboard />
      <YStack gap="$4">
        <PageHeader
          title="Explore products"
          subtitle={`Open and manage every ${config.brandName} product from one place.`}
        />
        {groups.map((group, i) => (
        <FadeIn key={group.category} index={i} style={{ width: '100%' }}>
          <YStack gap="$3">
            <Text fontSize="$5" fontWeight="800" color="$color12">
              {group.category}
            </Text>
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
