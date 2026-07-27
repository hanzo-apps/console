'use client'

/**
 * Marketplace — the storefront over the REAL model catalog (`/v1/pricing/models`
 * via `aicatalog.fetchCatalog`, through the authenticated `/ai` proxy so the user
 * bearer is attached server-side, never in the browser). The GCP-Marketplace
 * equivalent: browse deployable AI models & providers, by category, with a
 * featured shelf and real per-Mtok pricing, then open one in the Playground.
 *
 * This is a DISTINCT surface from Model Catalog (the model table) and Providers
 * (the vendor grid): it is the curated STOREFRONT — category tiles, a featured
 * row, and filterable listings — but it reads the SAME one real catalog and reuses
 * the SAME `aicatalog` client + `ProviderLogo`. Nothing is fabricated: every
 * price/count/context is a real field, rendered '—' when absent; the grouping and
 * featured selection are the pure, unit-tested `marketplace/logic`. On a catalog
 * failure it shows the shared honest `ErrorState` — never placeholder listings.
 *
 * All style props use the v5 shorthand set (bg/p/px/py/gap/rounded/items/self/…).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, X, Play, ArrowRight, ShieldCheck, Store } from '@hanzogui/lucide-icons-2'

import {
  fetchCatalog,
  displayProvider,
  modelId,
  modelType,
  modelContext,
  fmtPrice,
  fmtContext,
  type CatalogEntry,
} from '~/lib/api/aicatalog'
import { categorize, featured, applyFilters, marketStats, listingTitle } from './marketplace/logic'
import { playgroundPathForModel } from './playground/share'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { brandForModel, brandLabel } from '~/components/ui/brand'
import { PageHeader } from '~/components/ui/PageHeader'
import { ErrorState, asApiError } from '~/components/ui/States'
import { Loader } from '~/components/ui/Loader'
import { Filters } from '~/components/ui/Filters'
import { useList } from '~/lib/list'
import type { ApiError } from '~/lib/api'

/** The "Verified" pill for our first-party (Zen) listings. */
const VerifiedBadge = () => (
  <XStack items="center" gap="$1" px="$1.5" py="$0.5" rounded="$10" bg="$green3">
    <ShieldCheck size={10} color="$green11" />
    <Text fontSize="$1" color="$green11" fontWeight="700">
      Verified
    </Text>
  </XStack>
)

/** A summary stat cell for the storefront footer. */
const Stat = ({ label, value }: { label: string; value: string }) => (
  <YStack flex={1} minW={140} gap={2} px="$3" py="$2.5">
    <Text fontSize="$6" fontWeight="700" color="$color12">
      {value}
    </Text>
    <Text fontSize="$1" color="$color10">
      {label}
    </Text>
  </YStack>
)

/** One category tile — a modality bucket with its real listing + availability counts. */
function CategoryTile({
  cat,
  active,
  onPress,
}: {
  cat: { type: string; count: number; available: number }
  active: boolean
  onPress: () => void
}) {
  return (
    <YStack
      width={150}
      gap="$1.5"
      p="$3"
      rounded="$4"
      borderWidth={1}
      borderColor={active ? '$color8' : '$borderColor'}
      bg={active ? '$color4' : '$color1'}
      cursor="pointer"
      hoverStyle={{ borderColor: '$color8' }}
      onPress={onPress}
    >
      <Text fontSize="$4" fontWeight="700" color="$color12">
        {cat.type}
      </Text>
      <XStack gap="$2" flexWrap="wrap">
        <Text fontSize="$1" color="$color10">
          {cat.count} {cat.count === 1 ? 'listing' : 'listings'}
        </Text>
        {cat.available > 0 ? (
          <Text fontSize="$1" color="$green11">
            {cat.available} live
          </Text>
        ) : null}
      </XStack>
    </YStack>
  )
}

/** One marketplace listing card — a real model with vendor, pricing, context, CTA. */
function ListingCard({ m, onOpen }: { m: CatalogEntry; onOpen: () => void }) {
  // Resolve the listing's brand ONCE from the model identity (id/name) — so the logo,
  // the vendor label, and the house "Verified" badge always agree, and a gateway-served
  // third-party model (tagged provider "hanzo") reads as its TRUE vendor, never the house.
  const id = modelId(m)
  const brand = brandForModel(id, m.provider ?? '')
  const house = brand === 'zen' || brand === 'hanzo'
  const providerLabel = brand && !house ? brandLabel(brand) : displayProvider(m.provider)
  return (
    <YStack
      width={300}
      gap="$2.5"
      p="$3.5"
      rounded="$4"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
      hoverStyle={{ borderColor: '$color8' }}
    >
      <XStack items="center" gap="$2.5">
        <ProviderLogo provider={m.provider ?? 'Other'} model={id} size={30} />
        <YStack flex={1}>
          <Text fontSize="$4" fontWeight="700" color="$color12" numberOfLines={1}>
            {listingTitle(m)}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {providerLabel}
          </Text>
        </YStack>
        {house ? <VerifiedBadge /> : null}
      </XStack>

      {m.description ? (
        <Text fontSize="$2" color="$color10" numberOfLines={2}>
          {m.description}
        </Text>
      ) : null}

      <XStack gap="$3" flexWrap="wrap">
        <YStack gap={1}>
          <Text fontSize="$1" color="$color10">
            Type
          </Text>
          <Text fontSize="$2" color="$color11">
            {modelType(m)}
          </Text>
        </YStack>
        <YStack gap={1}>
          <Text fontSize="$1" color="$color10">
            Context
          </Text>
          <Text fontSize="$2" color="$color11">
            {fmtContext(modelContext(m))}
          </Text>
        </YStack>
        <YStack gap={1}>
          <Text fontSize="$1" color="$color10">
            In / Out $/M
          </Text>
          <Text fontSize="$2" color="$color11">
            {fmtPrice(m.pricing?.input)} / {fmtPrice(m.pricing?.output)}
          </Text>
        </YStack>
      </XStack>

      <XStack items="center" justify="space-between">
        <Text fontSize="$1" color={m.available ? '$green11' : '$color10'}>
          {m.available ? '● Available now' : 'Catalog'}
        </Text>
        <Button size="$2" chromeless iconAfter={<ArrowRight size={14} />} onPress={onOpen}>
          {m.available ? 'Try it' : 'Details'}
        </Button>
      </XStack>
    </YStack>
  )
}

/** The featured shelf — the catalog's own highlighted listings (real, honest). */
function FeaturedShelf({ items, onOpen }: { items: CatalogEntry[]; onOpen: (m: CatalogEntry) => void }) {
  if (items.length === 0) return null
  return (
    <YStack gap="$2">
      <Text fontSize="$2" color="$color11" fontWeight="500">
        Featured
      </Text>
      <XStack gap="$3" flexWrap="wrap">
        {items.map((m) => (
          <ListingCard key={m.id ?? m.name} m={m} onOpen={() => onOpen(m)} />
        ))}
      </XStack>
    </YStack>
  )
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; models: CatalogEntry[] }

export function MarketplaceModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  // Search, chosen category and the availability toggle are the user's own view of
  // the storefront, so they live in the ONE persisted list state rather than in
  // three `useState`s a single navigation throws away. A facet is stored only when
  // it narrows something — "All" and "off" are the ABSENCE of a facet, never a
  // stored sentinel — which is what keeps `active`/Reset honest.
  const list = useList('marketplace')
  const query = list.q
  const category = list.filter('category') || null
  const availableOnly = list.filter('available') === 'now'
  const setCategory = (c: string | null) => list.setFilter('category', c ?? '')

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    fetchCatalog()
      .then((models) => setState({ phase: 'ready', models }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const models = state.phase === 'ready' ? state.models : []
  const categories = useMemo(() => categorize(models), [models])
  const shelf = useMemo(() => featured(models), [models])
  const listings = useMemo(
    () => applyFilters(models, { query, category, availableOnly }),
    [models, query, category, availableOnly],
  )
  const stats = useMemo(() => marketStats(listings), [listings])

  // Open a listing in the Playground PRESELECTED on this model (available now) or the
  // Model Catalog (catalog-only). Same deep-link helper the catalog's "Try" uses (DRY).
  const open = (m: CatalogEntry) => {
    if (m.available) router.push(playgroundPathForModel(m.id ?? m.name))
    else router.push('/models')
  }

  const filtering = list.active > 0

  return (
    <>
      <PageHeader
        title="Marketplace"
        subtitle="Browse and deploy AI models and providers — real pricing, live availability, one unified API."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'error' ? (
        <ErrorState
          err={state.err}
          onRetry={run}
          copy={{
            notFound:
              'The marketplace catalog (/v1/pricing/models) is not routed on this host yet. Listings appear automatically once the deployment proxies it through the gateway.',
          }}
        />
      ) : state.phase === 'loading' ? (
        <Loader label="Loading marketplace…" />
      ) : (
        <>
          {/* Featured shelf — only when NOT actively filtering, so it stays a storefront. */}
          {!filtering ? <FeaturedShelf items={shelf} onOpen={open} /> : null}

          {/* Category tiles */}
          {categories.length > 0 ? (
            <YStack gap="$2">
              <Text fontSize="$2" color="$color11" fontWeight="500">
                Categories
              </Text>
              <XStack gap="$2.5" flexWrap="wrap">
                <CategoryTile
                  cat={{ type: 'All', count: models.length, available: models.filter((x) => x.available).length }}
                  active={category === null}
                  onPress={() => setCategory(null)}
                />
                {categories.map((c) => (
                  <CategoryTile
                    key={c.type}
                    cat={c}
                    active={category === c.type}
                    onPress={() => setCategory(category === c.type ? null : c.type)}
                  />
                ))}
              </XStack>
            </YStack>
          ) : null}

          {/* Search + available-only — the ONE list bar; the toggle rides along as
              its trailing control, so search, facets and Reset stay in one row. */}
          <Filters list={list} placeholder="Search listings, providers, descriptions…">
            <Button
              size="$2"
              icon={<Play size={14} />}
              bg={availableOnly ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              aria-pressed={availableOnly}
              onPress={() => list.setFilter('available', availableOnly ? '' : 'now')}
            >
              Available now
            </Button>
          </Filters>

          {/* Listings grid */}
          {listings.length === 0 ? (
            <YStack p="$6" items="center" borderWidth={1} borderColor="$borderColor" rounded="$4" gap="$2">
              <Store size={22} opacity={0.5} />
              <Text color="$color11">
                {filtering
                  ? 'No listings match your search and filters.'
                  : 'No listings available on this deployment yet.'}
              </Text>
              {filtering ? (
                <Button
                  size="$2"
                  chromeless
                  icon={<X size={14} />}
                  onPress={list.reset}
                >
                  Clear filters
                </Button>
              ) : null}
            </YStack>
          ) : (
            <XStack gap="$3" flexWrap="wrap">
              {listings.map((m) => (
                <ListingCard key={m.id ?? m.name} m={m} onOpen={() => open(m)} />
              ))}
            </XStack>
          )}

          {/* Storefront summary */}
          {listings.length > 0 ? (
            <XStack rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color1" mt="$2" flexWrap="wrap">
              <Stat label="Listings" value={String(stats.listings)} />
              <Stat label="Providers" value={String(stats.providers)} />
              <Stat label="Available now" value={String(stats.available)} />
              <Stat label="Categories" value={String(stats.categories)} />
            </XStack>
          ) : null}
        </>
      )}
    </>
  )
}

