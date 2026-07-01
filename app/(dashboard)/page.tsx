'use client'

/**
 * Product catalog — the unified console home. Every Hanzo product, grouped by
 * the ten canonical categories, with its enablement state and Google Cloud
 * equivalent. `enabled` and `external` products open straight in (in-console or
 * a new tab); `soon` products link to their discover screen. Each card can be
 * pinned to the sidebar (persisted to the account). Rendered entirely from the
 * catalog registry.
 */
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Star, Lock, ExternalLink, ArrowRight, Info } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { visibleCatalogByCategory, type CatalogEntry } from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { useIsGlobalAdmin } from '~/lib/auth/admin'
import { PageHeader } from '~/components/ui/PageHeader'
import { FadeIn } from '~/components/ui/FadeIn'
import OverviewDashboard from '~/components/products/OverviewModule'

const STATUS_LABEL = { enabled: 'Enabled', external: 'External', soon: 'Soon' } as const
const STATUS_BG = { enabled: '$color5', external: '$color3', soon: '$color4' } as const

function StatusBadge({ entry }: { entry: CatalogEntry }) {
  return (
    <XStack bg={STATUS_BG[entry.status]} px="$2" py="$1" rounded="$10" items="center" gap="$1">
      {entry.admin ? <Lock size={11} opacity={0.6} /> : null}
      <Text fontSize="$1" color={entry.status === 'enabled' ? '$color12' : '$color11'} fontWeight="600">
        {STATUS_LABEL[entry.status]}
      </Text>
    </XStack>
  )
}

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
  const openable = entry.status === 'enabled' || entry.status === 'external'
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
          <Button
            size="$2"
            chromeless
            opacity={0.4}
            icon={<Info size={15} />}
            onPress={onLearnMore}
            aria-label={`Learn about ${entry.label}`}
          />
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
        <StatusBadge entry={entry} />
        <Button
          size="$2"
          bg={openable ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={openable ? onOpen : onLearnMore}
          iconAfter={entry.kind === 'external' ? <ExternalLink size={14} /> : <ArrowRight size={14} />}
        >
          {openable ? 'Open' : 'Learn more'}
        </Button>
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

  return (
    <YStack gap="$7">
      <OverviewDashboard />
      <YStack gap="$4">
        <PageHeader
          title="Explore products"
          subtitle={`See, enable, and manage every ${config.brandName} product from one place.`}
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
