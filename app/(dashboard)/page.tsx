'use client'

/**
 * Product catalog — the unified console home. Every Hanzo product, grouped by
 * category, with its enablement state. `enabled` products open straight in;
 * `available` products offer a "Get started" onboarding affordance. Each card
 * can be pinned to the sidebar (persisted to the account). Rendered entirely
 * from the catalog registry.
 */
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Star, Lock, ExternalLink, ArrowRight } from '@hanzogui/lucide-icons-2'

import { branding, config } from '~/config'
import { catalogByCategory, type CatalogEntry } from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { PageHeader } from '~/components/ui/PageHeader'

function StatusBadge({ entry }: { entry: CatalogEntry }) {
  const label =
    entry.status === 'enabled'
      ? 'Enabled'
      : entry.status === 'soon'
        ? 'Soon'
        : entry.status === 'waitlist'
          ? 'Waitlist'
          : 'Available'
  const bg =
    entry.status === 'enabled'
      ? '$color5'
      : entry.status === 'waitlist'
        ? '$color4'
        : entry.status === 'soon'
          ? '$color4'
          : '$color3'
  return (
    <XStack bg={bg} px="$2" py="$1" rounded="$10" items="center" gap="$1">
      {entry.admin ? <Lock size={11} opacity={0.6} /> : null}
      <Text fontSize="$1" color={entry.status === 'enabled' ? '$color12' : '$color11'} fontWeight="600">
        {label}
      </Text>
    </XStack>
  )
}

function ProductCard({
  entry,
  pinned,
  onOpen,
  onToggle,
}: {
  entry: CatalogEntry
  pinned: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const Icon = entry.icon
  const enabled = entry.status === 'enabled'
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" width={272}>
      <XStack justify="space-between" items="flex-start">
        <XStack gap="$2" items="center" flex={1}>
          <Icon size={20} />
          <Text fontSize="$5" fontWeight="700">
            {entry.label}
          </Text>
        </XStack>
        <Button
          size="$2"
          chromeless
          opacity={pinned ? 1 : 0.3}
          icon={<Star size={15} />}
          onPress={onToggle}
          aria-label={pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
        />
      </XStack>

      <Text fontSize="$3" color="$color11" minH={40}>
        {entry.description}
      </Text>

      <XStack justify="space-between" items="center">
        <StatusBadge entry={entry} />
        <Button
          size="$2"
          bg={enabled ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={onOpen}
          iconAfter={entry.kind === 'external' ? <ExternalLink size={14} /> : <ArrowRight size={14} />}
        >
          {enabled ? 'Open' : 'Get started'}
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
    <>
      <PageHeader
        title={branding.name}
        subtitle={`See, enable, and manage every ${config.brandName} product from one place.`}
      />
      {groups.map((group) => (
        <YStack key={group.category} gap="$3">
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
              />
            ))}
          </XStack>
        </YStack>
      ))}
    </>
  )
}
