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
import { Star, Lock, ArrowRight, BookOpen, KeyRound, Boxes, HandCoins, ExternalLink } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { shellFor } from '~/lib/products/shell'
import { visibleCatalogByCategory, categorySlug, type CatalogEntry } from '~/lib/products/registry'
import { resolveView } from '~/lib/products/match'
import { ProductRoute } from '~/components/ProductRoute'
import { openProduct } from '~/lib/products/open'
import { useFavorites } from '~/lib/products/favorites'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { ProductIcon } from '~/components/ui/ProductIcon'
import type { IconLike } from '~/components/ui/color'
import { useProductColors } from '~/lib/products/pins'
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

/**
 * Primary action tile — the ONE presentational card for a top-of-home "first action"
 * (get an API key, deploy an OSS project, earn from your OSS). Prop-driven and pure: a
 * ProductIcon tile (the shared product-color system; omit `color` for the neutral chip),
 * a title, a one-line blurb, and a single CTA. Reused for EVERY primary action so the row
 * stays DRY — add an action by rendering one more tile, never a new card. `external` swaps
 * the CTA's trailing glyph to the new-tab mark; `dataTour` anchors the first-run tour (the
 * API-key tile keeps its `api-key` anchor). No data fetch — a tile is cheap on first paint;
 * anything heavy (e.g. the OSS catalog) lives behind the CTA, loaded only on press.
 */
function PrimaryActionTile({
  icon,
  color,
  title,
  description,
  ctaLabel,
  external,
  dataTour,
  onPress,
}: {
  icon: IconLike
  color?: string
  title: string
  description: string
  ctaLabel: string
  external?: boolean
  dataTour?: string
  onPress: () => void
}) {
  return (
    <Card flex={1} minW={280} borderWidth={1} borderColor="$borderColor" bg="$color2" p="$4" gap="$3" data-tour={dataTour}>
      <XStack items="center" gap="$3">
        <ProductIcon icon={icon} color={color} size={40} />
        <Text fontSize="$5" fontWeight="800" flex={1} numberOfLines={1}>
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11" minH={40}>
        {description}
      </Text>
      <XStack>
        <PrimaryButton
          size="$3"
          iconAfter={external ? <ExternalLink size={15} /> : <ArrowRight size={15} />}
          onPress={onPress}
        >
          {ctaLabel}
        </PrimaryButton>
      </XStack>
    </Card>
  )
}

export default function DashboardHome() {
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const { toggle, isPinned } = useFavorites()
  const { colorOf } = useProductColors()
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
      {/* Primary actions — the first, most prominent things a signed-in user can do:
          get an API key, deploy an open-source project (the platform template catalog),
          and earn from their own OSS (the Authors revenue-share). ONE tile primitive,
          three uses; wraps to stack on narrow viewports. The Deploy tile opens the
          external OSS catalog on press — no eager fetch, so first paint stays cheap. */}
      <XStack flexWrap="wrap" gap="$3">
        <PrimaryActionTile
          icon={KeyRound}
          title="Get your API key"
          description={`Call ${config.brandName} models from your apps, SDKs, and CLI with a personal key.`}
          ctaLabel="Get API key"
          dataTour="api-key"
          onPress={() => push('/api-keys')}
        />
        <PrimaryActionTile
          icon={Boxes}
          color={colorOf('store')}
          title="Deploy OSS"
          description="Deploy Postgres, n8n, Grafana, Supabase and more — one-click open-source apps on Hanzo Cloud."
          ctaLabel="Browse the App Store"
          onPress={() => push('/store')}
        />
        <PrimaryActionTile
          icon={HandCoins}
          color={colorOf('authors')}
          title="Earn from your OSS"
          description="Earn 20% of the compute margin your open-source project drives when teams run it on Hanzo Cloud — paid to your Hanzo wallet."
          ctaLabel="Start earning"
          onPress={() => push('/authors')}
        />
      </XStack>
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
