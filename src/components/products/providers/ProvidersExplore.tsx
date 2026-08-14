'use client'

/**
 * Providers — Explore. The real provider catalog, grouped from
 * `/v1/pricing/models`: every provider that actually serves models (Zen, OpenAI,
 * Qwen, Anthropic, Meta, Mistral, …) as a card with its logo, model count,
 * context reach, cheapest input price, a "Verified" badge for our first-party
 * Zen models, and a few model chips. Search + filter (type/context/pricing/
 * verified) + sort are client-side over the loaded catalog. Three action cards
 * lead to the real flows. The My Providers / Custom Models tabs are honest: they
 * point at the real add/deploy flow (route to any provider, your own credentials,
 * or a self-hosted endpoint/weights) rather than fabricating inventory. Honest
 * loading/error/empty — never a fabricated provider.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import {
  Boxes,
  Upload,
  Code2,
  ArrowRight,
  ArrowLeft,
  Plus,
  Search,
  ShieldCheck,
  ArrowUpDown,
  Layers,
  Cpu,
  X,
} from '@hanzogui/lucide-icons-2'

import {
  fetchCatalog,
  groupByProvider,
  displayProvider,
  modelType,
  modelTypes,
  modelContext,
  modelDisplayName,
  priceBucket,
  PRICE_BUCKETS,
  CONTEXT_BUCKETS,
  fmtPrice,
  fmtContext,
  type CatalogEntry,
  type ProviderGroup,
  type PriceBucket,
  type ContextBucket,
} from '~/lib/api/aicatalog'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { ErrorState, asApiError } from '~/components/ui/States'
import { Loader } from '~/components/ui/Loader'
import type { ApiError } from '~/lib/api'
import { PageHeader, SelectMenu } from '@hanzo/ui/product'

type Tab = 'explore' | 'mine' | 'custom'
type SortKey = 'models' | 'name' | 'price' | 'context'

// 'models' (most models) is the default, represented by the dropdown's "All" row
// (allLabel), so it is NOT repeated as an explicit option.
const SORT_DEFAULT_LABEL = 'Most models'
const SORT_OPTIONS: { key: Exclude<SortKey, 'models'>; label: string }[] = [
  { key: 'name', label: 'Name A–Z' },
  { key: 'price', label: 'Cheapest first' },
  { key: 'context', label: 'Largest context' },
]

const TABS: { key: Tab; label: string }[] = [
  { key: 'explore', label: 'Explore' },
  { key: 'mine', label: 'My Providers' },
  { key: 'custom', label: 'Custom Models' },
]

function ActionCard({
  icon,
  title,
  body,
  cta,
  onPress,
}: {
  icon: ReactNode
  title: string
  body: string
  cta: string
  onPress: () => void
}) {
  return (
    <YStack
      flex={1}
      minW={240}
      gap="$2"
      p="$3.5"
      rounded="$4"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
    >
      <XStack items="center" gap="$2">
        {icon}
        <Text fontSize="$4" fontWeight="700" color="$color12">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color10" flex={1}>
        {body}
      </Text>
      <Button size="$2" self="flex-start" onPress={onPress}>
        {cta}
      </Button>
    </YStack>
  )
}

/** The "Verified" pill for our first-party (Zen) providers. */
const VerifiedBadge = () => (
  <XStack items="center" gap="$1" px="$2" py="$0.5" rounded="$10" bg="$green3">
    <ShieldCheck size={11} color="$green11" />
    <Text fontSize="$1" color="$green11" fontWeight="700">
      Verified
    </Text>
  </XStack>
)

function ProviderCard({ g, onOpen }: { g: ProviderGroup; onOpen: () => void }) {
  const name = displayProvider(g.provider)
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
        <ProviderLogo provider={g.provider} size={32} />
        <YStack flex={1}>
          <Text fontSize="$5" fontWeight="700" color="$color12" numberOfLines={1}>
            {name}
          </Text>
        </YStack>
        {g.verified ? <VerifiedBadge /> : null}
      </XStack>
      <XStack gap="$3" flexWrap="wrap">
        <Text fontSize="$1" color="$color10">
          {g.count} {g.count === 1 ? 'model' : 'models'}
        </Text>
        <Text fontSize="$1" color="$color10">
          {fmtContext(g.maxContext)} context
        </Text>
        <Text fontSize="$1" color="$color10">
          from {fmtPrice(g.minInput)} / Mtok
        </Text>
      </XStack>
      <XStack gap="$1" flexWrap="wrap">
        {g.sample.map((s) => (
          <Text key={s} fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
            {s}
          </Text>
        ))}
        {g.count > g.sample.length ? (
          <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
            +{g.count - g.sample.length}
          </Text>
        ) : null}
      </XStack>
      <Button
        size="$2"
        chromeless
        self="flex-start"
        iconAfter={<ArrowRight size={14} />}
        onPress={onOpen}
      >
        View models
      </Button>
    </YStack>
  )
}

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

/** Provider detail — metadata + the provider's full model list. */
function ProviderDetailPanel({ g, onBack }: { g: ProviderGroup; onBack: () => void }) {
  const name = displayProvider(g.provider)
  return (
    <YStack gap="$4">
      <Button size="$2" chromeless self="flex-start" icon={<ArrowLeft size={16} />} onPress={onBack}>
        Providers
      </Button>

      <XStack items="center" gap="$3" flexWrap="wrap">
        <ProviderLogo provider={g.provider} size={40} />
        <Text fontSize="$8" fontWeight="800" color="$color12">
          {name}
        </Text>
        {g.verified ? <VerifiedBadge /> : null}
      </XStack>

      <XStack
        gap="$5"
        flexWrap="wrap"
        rounded="$4"
        borderWidth={1}
        borderColor="$borderColor"
        bg="$color1"
        p="$4"
      >
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{String(g.count)}</Text>
          <Text fontSize="$1" color="$color10">Models</Text>
        </YStack>
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{fmtContext(g.maxContext)}</Text>
          <Text fontSize="$1" color="$color10">Max context</Text>
        </YStack>
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{fmtPrice(g.minInput)}</Text>
          <Text fontSize="$1" color="$color10">From / Mtok</Text>
        </YStack>
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{String(g.available)}</Text>
          <Text fontSize="$1" color="$color10">Available now</Text>
        </YStack>
      </XStack>

      <YStack gap={0} rounded="$4" borderWidth={1} borderColor="$borderColor" overflow="hidden">
        <XStack px="$3" py="$2" bg="$color2" gap="$3">
          <Text flex={1} fontSize="$1" color="$color10">Model</Text>
          <Text width={90} fontSize="$1" color="$color10">Type</Text>
          <Text width={80} fontSize="$1" color="$color10">Context</Text>
          <Text width={90} fontSize="$1" color="$color10">In / out $</Text>
          <Text width={90} fontSize="$1" color="$color10">Status</Text>
        </XStack>
        {g.models.map((m) => (
          <XStack key={m.id ?? m.name} px="$3" py="$2.5" gap="$3" borderTopWidth={1} borderColor="$borderColor" items="center">
            <YStack flex={1} gap={1}>
              <Text fontSize="$3" color="$color12" numberOfLines={1}>{modelDisplayName(m)}</Text>
              {m.description ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{m.description}</Text> : null}
            </YStack>
            <Text width={90} fontSize="$2" color="$color11">{modelType(m)}</Text>
            <Text width={80} fontSize="$2" color="$color11">{fmtContext(modelContext(m))}</Text>
            <Text width={90} fontSize="$2" color="$color11">{fmtPrice(m.pricing?.input)} / {fmtPrice(m.pricing?.output)}</Text>
            <Text width={90} fontSize="$1" color={m.available ? '$green11' : '$color10'}>
              {m.available ? '● Available' : 'Catalog'}
            </Text>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

/** Honest panel for the non-Explore tabs — points at the real flow, no fake rows. */
function HonestTab({
  icon,
  title,
  body,
  cta,
  onPress,
}: {
  icon: ReactNode
  title: string
  body: string
  cta: string
  onPress: () => void
}) {
  return (
    <YStack
      gap="$3"
      p="$6"
      rounded="$4"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
      items="center"
      maxW={560}
    >
      <XStack
        width={48}
        height={48}
        items="center"
        justify="center"
        rounded="$5"
        bg="$color3"
      >
        {icon}
      </XStack>
      <XStack items="center" gap="$2">
        <Text fontSize="$6" fontWeight="800" color="$color12">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color10" text="center">
        {body}
      </Text>
      <Button size="$3" onPress={onPress}>
        {cta}
      </Button>
    </YStack>
  )
}

const ctxMin = (b: ContextBucket): number => CONTEXT_BUCKETS.find((c) => c.key === b)?.min ?? 0

function providerMatches(g: ProviderGroup, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  if (displayProvider(g.provider).toLowerCase().includes(needle)) return true
  return g.models.some((m) => modelDisplayName(m).toLowerCase().includes(needle))
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; models: CatalogEntry[] }

export function ProvidersExplore({ onAddCustom }: { onAddCustom: () => void }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [tab, setTab] = useState<Tab>('explore')
  const [selected, setSelected] = useState<ProviderGroup | null>(null)

  // Explore filters (client-side over the loaded catalog).
  const [query, setQuery] = useState('')
  const [type, setType] = useState<string | null>(null)
  const [context, setContext] = useState<ContextBucket | null>(null)
  const [price, setPrice] = useState<PriceBucket | null>(null)
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('models')

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    fetchCatalog()
      .then((models) => setState({ phase: 'ready', models }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const docsUrl = 'https://docs.hanzo.ai'
  const models = state.phase === 'ready' ? state.models : []
  const groups = useMemo(() => groupByProvider(models), [models])
  const typeOptions = useMemo(() => modelTypes(models).map((t) => ({ key: t, label: t })), [models])

  const visible = useMemo(() => {
    const out = groups.filter((g) => {
      if (verifiedOnly && !g.verified) return false
      if (!providerMatches(g, query)) return false
      if (type && !g.models.some((m) => modelType(m) === type)) return false
      if (context && !(g.maxContext != null && g.maxContext >= ctxMin(context))) return false
      if (price && !g.models.some((m) => priceBucket(m) === price)) return false
      return true
    })
    const big = Number.MAX_SAFE_INTEGER
    out.sort((a, b) => {
      switch (sort) {
        case 'name':
          return displayProvider(a.provider).localeCompare(displayProvider(b.provider))
        case 'price':
          return (a.minInput ?? big) - (b.minInput ?? big)
        case 'context':
          return (b.maxContext ?? -1) - (a.maxContext ?? -1)
        default:
          return b.count - a.count
      }
    })
    return out
  }, [groups, verifiedOnly, query, type, context, price, sort])

  const activeFilters = (type ? 1 : 0) + (context ? 1 : 0) + (price ? 1 : 0) + (verifiedOnly ? 1 : 0)
  const total = models.length
  const available = useMemo(() => models.filter((m) => m.available).length, [models])

  // Click-through provider detail — metadata + the provider's model list.
  if (selected) {
    return <ProviderDetailPanel g={selected} onBack={() => setSelected(null)} />
  }

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Explore AI model providers, deploy custom models, or bring your own weights."
        actions={
          <Button size="$2" icon={<Plus size={15} />} onPress={onAddCustom}>
            Add custom
          </Button>
        }
      />

      {/* Tabs */}
      <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" self="flex-start" overflow="hidden">
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <Button
              key={t.key}
              size="$2"
              chromeless={!active}
              bg={active ? '$color5' : 'transparent'}
              rounded="$0"
              onPress={() => setTab(t.key)}
            >
              <Text fontSize="$2" fontWeight={active ? '700' : '500'} color={active ? '$color12' : '$color10'}>
                {t.label}
              </Text>
            </Button>
          )
        })}
      </XStack>

      {tab === 'explore' ? (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <ActionCard
              icon={<Boxes size={18} />}
              title="Deploy custom models"
              body="Point Hanzo at a model on a provider you already use, and call it through the same /v1 API."
              cta="Create custom model"
              onPress={onAddCustom}
            />
            <ActionCard
              icon={<Upload size={18} />}
              title="Bring your own weights"
              body="Upload your own weights and serve them on Hanzo, private to your organization."
              cta="Upload weights"
              onPress={onAddCustom}
            />
            <ActionCard
              icon={<Code2 size={18} />}
              title="Build with APIs"
              body="Reach every provider here through one API and one SDK, with one key."
              cta="View docs"
              onPress={() => typeof window !== 'undefined' && window.open(docsUrl, '_blank', 'noopener')}
            />
          </XStack>

          {state.phase === 'error' ? (
            <ErrorState err={state.err} onRetry={run} />
          ) : state.phase === 'loading' ? (
            <Loader label="Loading providers…" />
          ) : (
            <>
              {/* Search + filter + sort row */}
              <XStack gap="$2" items="center" flexWrap="wrap">
                <XStack
                  flex={1}
                  minW={220}
                  items="center"
                  gap="$2"
                  px="$2.5"
                  py="$1.5"
                  rounded="$3"
                  borderWidth={1}
                  borderColor="$borderColor"
                  bg="$color1"
                >
                  <Search size={14} opacity={0.6} />
                  <Input
                    flex={1}
                    size="$2"
                    borderWidth={0}
                    bg="transparent"
                    placeholder="Search providers and models…"
                    value={query}
                    onChangeText={setQuery}
                    autoCapitalize="none"
                  />
                  {query ? (
                    <Button size="$1" chromeless circular icon={<X size={13} />} onPress={() => setQuery('')} />
                  ) : null}
                </XStack>
                <SelectMenu options={typeOptions} value={type} onChange={setType} allLabel="All types" icon={<Layers size={14} />} />
                <SelectMenu
                  options={CONTEXT_BUCKETS.map((c) => ({ key: c.key, label: c.label }))}
                  value={context}
                  onChange={setContext}
                  allLabel="All contexts"
                  icon={<Cpu size={14} />}
                />
                <SelectMenu options={PRICE_BUCKETS} value={price} onChange={setPrice} allLabel="All pricing" />
                <Button
                  size="$2"
                  icon={<ShieldCheck size={15} />}
                  bg={verifiedOnly ? '$color5' : 'transparent'}
                  borderWidth={1}
                  borderColor="$borderColor"
                  onPress={() => setVerifiedOnly((v) => !v)}
                >
                  Verified only
                </Button>
                <SelectMenu
                  options={SORT_OPTIONS}
                  value={sort === 'models' ? null : sort}
                  onChange={(v) => setSort(v ?? 'models')}
                  allLabel={SORT_DEFAULT_LABEL}
                  icon={<ArrowUpDown size={14} />}
                  minWidth={150}
                />
              </XStack>

              {visible.length === 0 ? (
                <YStack p="$6" items="center" borderWidth={1} borderColor="$borderColor" rounded="$4" gap="$2">
                  <Text color="$color11">
                    {activeFilters > 0 || query ? 'No providers match your search and filters.' : 'No providers available on this deployment yet.'}
                  </Text>
                  {activeFilters > 0 || query ? (
                    <Button
                      size="$2"
                      chromeless
                      icon={<X size={14} />}
                      onPress={() => {
                        setQuery('')
                        setType(null)
                        setContext(null)
                        setPrice(null)
                        setVerifiedOnly(false)
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </YStack>
              ) : (
                <XStack gap="$3" flexWrap="wrap">
                  {visible.map((g) => (
                    <ProviderCard key={g.provider} g={g} onOpen={() => setSelected(g)} />
                  ))}
                </XStack>
              )}

              <XStack
                rounded="$4"
                borderWidth={1}
                borderColor="$borderColor"
                bg="$color1"
                mt="$2"
                flexWrap="wrap"
              >
                <Stat label="Providers" value={String(visible.length)} />
                <Stat label="Total models" value={String(total)} />
                <Stat label="Available now" value={String(available)} />
              </XStack>
            </>
          )}
        </>
      ) : tab === 'mine' ? (
        <HonestTab
          icon={<Boxes size={22} />}
          title="My providers"
          body="Providers you configure for your organization appear here. Add a custom provider to route to your own API keys or self-hosted endpoints."
          cta="Add custom provider"
          onPress={onAddCustom}
        />
      ) : (
        <HonestTab
          icon={<Code2 size={22} />}
          title="Custom models"
          body="Route to any provider — or your own self-hosted endpoint and weights — with your own configuration and credentials. Custom model deployment is managed from the Add custom flow."
          cta="Create custom model"
          onPress={onAddCustom}
        />
      )}
    </>
  )
}
