'use client'

/**
 * CategoryOverview — the landing page for one product CATEGORY (AI, Compute,
 * Data, …). It is the category-level twin of `NativeOverview`: a header + a
 * one-line "what this category is", optional featured shortcuts, and a grid of
 * every product in the category (each card opening its native route). Every listed
 * product is live — nothing is hidden, faked, or shown as a dead placeholder.
 *
 * Everything is derived from the ONE catalog registry (`visibleCatalogByCategory`,
 * brand- and admin-scoped), so a new product appears here for free and there is no
 * fabricated data. Resolved from `/category/<slug>` via a route module in the
 * registry, so it flows through the same router/catch-all as products (DRY).
 *
 * All style props use the v5 shorthand set (bg/p/px/py/gap/rounded/items/self/...).
 */
import { notFound } from 'next/navigation'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Blocks,
  Code2,
  Cpu,
  Database,
  Lock,
  Network,
  Rocket,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Store,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import {
  visibleCatalogByCategory,
  categoryFromSlug,
  categorySlug,
  CATEGORY_SUMMARY,
  type CatalogEntry,
  type ProductCategory,
  type ProductIcon,
} from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { useEntitlements } from '~/lib/entitlements-context'
import { useProductColors } from '~/lib/products/pins'
import { categoryColorHex } from '~/lib/products/colors'
import { FadeIn, PageHeader, asColor } from '@hanzo/ui/product'

/** A representative icon per category (presentational — kept out of the taxonomy layer). */
const CATEGORY_ICON: Record<ProductCategory, ProductIcon> = {
  AI: Sparkles,
  Compute: Cpu,
  Data: Database,
  Network: Network,
  Security: Shield,
  Observe: Activity,
  Platform: Rocket,
  Dev: Code2,
  Web3: Blocks,
  Apps: Store,
  Settings: SlidersHorizontal,
}

/**
 * Products to surface as prominent header shortcuts for a category. Ids reference
 * real catalog entries and are resolved against the visible group, so an absent or
 * hidden id is simply skipped — never a dead or fabricated link. AI leads with the
 * Model Catalog and Providers (its two entry points); other categories rely on the
 * grid below.
 */
const CATEGORY_FEATURED: Partial<Record<ProductCategory, string[]>> = {
  AI: ['models', 'providers'],
}

/** One product card in the category grid — mirrors the catalog-home card (no pin). */
function ProductCard({
  entry,
  color,
  onOpen,
  onLearnMore,
}: {
  entry: CatalogEntry
  color: string
  onOpen: () => void
  onLearnMore: () => void
}) {
  const Icon = entry.icon
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" width={272}>
      <XStack justify="space-between" items="flex-start" gap="$2">
        <XStack gap="$2" items="center" flex={1}>
          <Icon size={20} color={asColor(color)} />
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
        <XStack gap="$1.5" items="center">
          {entry.admin ? <Lock size={13} opacity={0.45} /> : null}
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

/** The category landing page, resolved from `/category/<slug>`. */
export function CategoryOverview({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const showAdmin = useIsSuperAdmin()
  const { enabled } = useEntitlements()
  const { colorOf } = useProductColors()
  const push = (path: string) => router.push(path)

  const category = categoryFromSlug(params.slug ?? '')
  const group = category
    ? visibleCatalogByCategory(showAdmin, enabled).find((g) => g.category === category)
    : undefined

  // Unknown slug, or a category with nothing visible for this brand/role: honest 404.
  if (!category || !group) {
    notFound()
  }

  const Icon = CATEGORY_ICON[category]
  const count = group.entries.length
  const featured = (CATEGORY_FEATURED[category] ?? [])
    .map((id) => group.entries.find((e) => e.id === id))
    .filter((e): e is CatalogEntry => Boolean(e))

  // Category pager — step prev/next through the visible categories in their FIXED
  // order (the ONE `categoryOrder`, brand/admin-scoped), wrapping around so you can
  // cycle the whole cloud axis without returning to the home grid.
  const orderedCats = visibleCatalogByCategory(showAdmin, enabled).map((g) => g.category)
  const idx = orderedCats.indexOf(category)
  const prevCat = orderedCats.length > 1 ? orderedCats[(idx - 1 + orderedCats.length) % orderedCats.length] : null
  const nextCat = orderedCats.length > 1 ? orderedCats[(idx + 1) % orderedCats.length] : null

  return (
    <>
      <PageHeader
        title={category}
        subtitle={`${config.brandName} · ${count} ${count === 1 ? 'product' : 'products'}`}
        actions={
          featured.length ? (
            <>
              {featured.map((e, i) => {
                const FIcon = e.icon
                return (
                  <Button
                    key={e.id}
                    size="$3"
                    theme={i === 0 ? 'light' : undefined}
                    chromeless={i !== 0}
                    icon={<FIcon size={16} />}
                    onPress={() => openProduct(e, push)}
                  >
                    {e.label}
                  </Button>
                )
              })}
            </>
          ) : undefined
        }
      />

      {/* Identity + what-this-category-is */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" items="flex-start">
          <YStack width={44} height={44} items="center" justify="center" rounded="$4" bg="$color3">
            <Icon size={22} color={asColor(categoryColorHex(category))} />
          </YStack>
          <YStack flex={1} gap="$1">
            <Text fontSize="$6" fontWeight="800" color="$color12">
              {category}
            </Text>
            <Text fontSize="$3" color="$color11">
              {CATEGORY_SUMMARY[category]}
            </Text>
          </YStack>
        </XStack>
      </Card>

      {/* Every product in the category — derived live from the catalog */}
      <FadeIn style={{ width: '100%' }}>
        <XStack flexWrap="wrap" gap="$3">
          {group.entries.map((entry) => (
            <ProductCard
              key={entry.id}
              entry={entry}
              color={colorOf(entry.id)}
              onOpen={() => openProduct(entry, push)}
              onLearnMore={() => push(`/discover/${entry.id}`)}
            />
          ))}
        </XStack>
      </FadeIn>

      {/* Prev / next category — step through the cloud axis in its fixed order. */}
      {prevCat && nextCat ? (
        <XStack mt="$4" pt="$4" borderTopWidth={1} borderColor="$borderColor" justify="space-between" gap="$3" flexWrap="wrap">
          <Button
            size="$3"
            chromeless
            icon={<ArrowLeft size={16} />}
            onPress={() => push(`/category/${categorySlug(prevCat)}`)}
            aria-label={`Previous category: ${prevCat}`}
          >
            {prevCat}
          </Button>
          <Button
            size="$3"
            chromeless
            iconAfter={<ArrowRight size={16} />}
            onPress={() => push(`/category/${categorySlug(nextCat)}`)}
            aria-label={`Next category: ${nextCat}`}
          >
            {nextCat}
          </Button>
        </XStack>
      ) : null}
    </>
  )
}
