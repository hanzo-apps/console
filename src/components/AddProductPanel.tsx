'use client'

/**
 * All products — the directory where you curate your sidebar. Every Hanzo product
 * is always available on demand; this panel lists the FULL catalog the viewer may
 * see (brand-scoped, admin surfaces gated), grouped by category, each row with a
 * PIN toggle that promotes/removes it from the sidebar's Pinned quick-access section
 * (via `usePins`). Rendered in the shared DetailPane (opened from the sidebar's
 * "All products" row).
 *
 * Honest by construction: pinning is instant + optimistic (persisted through the
 * account preferences store — no async error state). Products with REAL org usage
 * carry an "In use" badge + an "In use" filter, derived from the charged usage
 * ledger (`fetchUsageRecords` → `inUseProductIds`); if that signal is unavailable
 * the badges/filter degrade away — never a fabricated "in use".
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Plus, Search, Star } from '@hanzogui/lucide-icons-2'

import { visibleCatalogByCategory, type CatalogEntry, type ProductIcon } from '~/lib/products/registry'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { usePins, useProductColors } from '~/lib/products/pins'
import { fetchUsageRecords } from '~/lib/api/aimetrics'
import { inUseProductIds } from '~/lib/products/product-usage'
import { asColor } from '~/components/ui/color'
import { EmptyState } from '~/components/ui/EmptyState'

/** The list narrowing controls at the top. */
type Filter = 'all' | 'inuse' | 'pinned'

/** A small "In use" pill — real org usage, never fabricated. */
function InUseBadge() {
  return (
    <XStack items="center" gap="$1.5" bg="$green3" px="$2" py="$1" rounded="$10">
      <Activity size={11} color="$green11" />
      <Text fontSize="$1" fontWeight="700" color="$green11">
        In use
      </Text>
    </XStack>
  )
}

/** One catalog row: icon · label/description (+ In-use badge) · pin toggle. */
function ProductRow({
  entry,
  color,
  pinned,
  inUse,
  onToggle,
}: {
  entry: CatalogEntry
  color: string
  pinned: boolean
  inUse: boolean
  onToggle: () => void
}) {
  const Icon = entry.icon
  return (
    <XStack items="center" gap="$3" py="$2" px="$2" rounded="$3" minH={44} hoverStyle={{ bg: '$color2' }}>
      <YStack width={32} height={32} rounded="$3" bg="$color3" items="center" justify="center">
        <Icon size={16} color={asColor(color)} />
      </YStack>
      <YStack flex={1} minW={0} gap="$0.5">
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {entry.label}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {entry.description}
        </Text>
      </YStack>
      {inUse ? <InUseBadge /> : null}
      <Button
        size="$2"
        icon={pinned ? <Star size={15} /> : <Plus size={15} />}
        onPress={onToggle}
        bg={pinned ? '$color5' : 'transparent'}
        borderWidth={1}
        borderColor="$borderColor"
        aria-label={pinned ? `Remove ${entry.label} from sidebar` : `Pin ${entry.label} to sidebar`}
      />
    </XStack>
  )
}

/** Segmented All | In use | Pinned filter (the "In use" tab only when the signal exists). */
function FilterTabs({
  value,
  onChange,
  showInUse,
}: {
  value: Filter
  onChange: (f: Filter) => void
  showInUse: boolean
}) {
  const opts: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    ...(showInUse ? [{ key: 'inuse' as const, label: 'In use' }] : []),
    { key: 'pinned', label: 'Pinned' },
  ]
  return (
    <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden" self="flex-start">
      {opts.map((o) => (
        <Button
          key={o.key}
          size="$2"
          chromeless
          rounded="$0"
          bg={value === o.key ? '$color5' : 'transparent'}
          onPress={() => onChange(o.key)}
          aria-label={`Filter ${o.label}`}
        >
          {o.label}
        </Button>
      ))}
    </XStack>
  )
}

export function AddProductPanel() {
  const showAdmin = useIsSuperAdmin()
  const { isPinned, toggle } = usePins()
  const { colorOf } = useProductColors()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // Real org usage signal. `null` = not (yet) known; a Set (even empty) = a real
  // answer. `usageFailed` distinguishes an errored fetch from still-loading so we can
  // note it honestly (never fabricate an "in use" state).
  const [inUse, setInUse] = useState<Set<string> | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchUsageRecords()
      .then((recs) => {
        if (alive) setInUse(inUseProductIds(recs))
      })
      .catch(() => {
        if (alive) setUsageFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const usageReady = inUse !== null

  // Source = the FULL catalog the viewer may see (ungated → both pinned and unpinned
  // appear), grouped by category.
  const groups = useMemo(() => visibleCatalogByCategory(showAdmin, null), [showAdmin])

  // Literal, case-insensitive substring match over label/description/id — NOT a
  // compiled RegExp of user input.
  const q = query.trim().toLowerCase()
  const matches = (e: CatalogEntry): boolean => {
    if (filter === 'pinned' && !isPinned(e.id)) return false
    if (filter === 'inuse' && !inUse?.has(e.id)) return false
    if (q && ![e.label, e.description, e.id].some((f) => f.toLowerCase().includes(q))) return false
    return true
  }

  const shown = groups
    .map((g) => ({ category: g.category, entries: g.entries.filter(matches) }))
    .filter((g) => g.entries.length > 0)

  const empty: { icon: ProductIcon; title: string; description: string } = q
    ? { icon: Search, title: 'No matches', description: `No products match “${query.trim()}”.` }
    : filter === 'inuse'
      ? {
          icon: Activity,
          title: 'No products in use yet',
          description: 'When your organization uses a product, it appears here so you can pin it to your sidebar.',
        }
      : filter === 'pinned'
        ? {
            icon: Star,
            title: 'No pinned products yet',
            description: 'Pin a product to add it to your sidebar’s quick-access section.',
          }
        : { icon: Search, title: 'No products', description: 'There are no products to show.' }

  return (
    <YStack p="$3" gap="$4">
      <YStack gap="$1">
        <Text fontSize="$2" color="$color10">
          Every product is available on demand — pin the ones you use to your sidebar. You only pay for what you use.
        </Text>
        {usageFailed ? (
          <Text fontSize="$1" color="$color9">
            Usage signal unavailable — in-use products can’t be highlighted right now.
          </Text>
        ) : null}
      </YStack>

      {/* Controls: search + filter. Wrap on narrow viewports. */}
      <XStack gap="$2.5" flexWrap="wrap" items="center">
        <XStack
          flex={1}
          minW={200}
          items="center"
          gap="$2"
          height={40}
          px="$3"
          rounded="$4"
          borderWidth={1}
          borderColor="$borderColor"
        >
          <Search size={16} opacity={0.6} />
          <Input
            flex={1}
            unstyled
            value={query}
            onChangeText={setQuery}
            placeholder="Search products…"
            fontSize="$3"
            color="$color12"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </XStack>
        <FilterTabs value={filter} onChange={setFilter} showInUse={usageReady} />
      </XStack>

      {shown.length === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
      ) : (
        shown.map((group) => (
          <YStack key={group.category} gap="$1">
            <Text fontSize="$1" color="$color10" fontWeight="500" px="$2">
              {group.category}
            </Text>
            {group.entries.map((entry) => (
              <ProductRow
                key={entry.id}
                entry={entry}
                color={colorOf(entry.id)}
                pinned={isPinned(entry.id)}
                inUse={inUse?.has(entry.id) ?? false}
                onToggle={() => toggle(entry.id)}
              />
            ))}
          </YStack>
        ))
      )}
    </YStack>
  )
}
