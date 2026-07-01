'use client'

/**
 * Model Catalog — the real, rich model catalog on @hanzo/gui.
 *
 * Source: the unified `/v1/pricing/models` catalog via `aicatalog.fetchCatalog`
 * (through the `/ai` proxy, so the user bearer is attached). Every column is a
 * REAL field — provider logo + name + params (specs), modality (derived from the
 * id), context (joined across the `context`/`contextWindow` shapes), per-Mtok
 * input/output pricing, the TRUE provider (qwen→Qwen, glm→Zhipu, our own → "Zen"),
 * and a live Available status (servable now) vs catalog-only. Search + filter by
 * type/provider/pricing are client-side over the loaded catalog. Honest
 * loading/error/empty; nothing fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, ArrowLeft, Play, Settings2, Copy, Search, SlidersHorizontal, X, Boxes } from '@hanzogui/lucide-icons-2'

import {
  fetchCatalog,
  fetchPlans,
  plansForTier,
  displayProvider,
  modelType,
  modelTypes,
  modelContext,
  modelDisplayName,
  matchesQuery,
  priceBucket,
  PRICE_BUCKETS,
  fmtPrice,
  fmtContext,
  type CatalogEntry,
  type Plan,
  type PriceBucket,
} from '~/lib/api/aicatalog'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError } from '~/components/ui/States'
import type { ApiError } from '~/lib/api'

const Pill = ({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'live' }) => (
  <Text
    fontSize="$1"
    px="$2"
    py="$1"
    rounded="$2"
    bg={tone === 'live' ? '$green3' : '$color3'}
    color={tone === 'live' ? '$green11' : '$color11'}
  >
    {label}
  </Text>
)

const columns: Column<CatalogEntry>[] = [
  {
    key: 'name',
    header: 'Model',
    render: (m) => (
      <XStack items="center" gap="$2.5" flex={1}>
        <ProviderLogo provider={m.provider ?? 'Other'} size={26} />
        <YStack gap={1} flex={1}>
          <XStack items="center" gap="$2">
            <Text fontSize="$3" color="$color12" numberOfLines={1}>
              {modelDisplayName(m)}
            </Text>
            {m.specs?.params ? (
              <Text fontSize="$1" color="$color10">
                {m.specs.params}
              </Text>
            ) : null}
          </XStack>
          {m.description ? (
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {m.description}
            </Text>
          ) : null}
        </YStack>
      </XStack>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    width: 100,
    render: (m) => <Pill label={modelType(m)} />,
  },
  {
    key: 'context',
    header: 'Context',
    width: 90,
    render: (m) => <Text fontSize="$3" color="$color11">{fmtContext(modelContext(m))}</Text>,
  },
  {
    key: 'pricing',
    header: 'Price $/M',
    width: 104,
    render: (m) => (
      <YStack gap={1}>
        <Text fontSize="$3" color="$color12">{fmtPrice(m.pricing?.input)}</Text>
        <Text fontSize="$1" color="$color10">{fmtPrice(m.pricing?.output)} out</Text>
      </YStack>
    ),
  },
  {
    key: 'provider',
    header: 'Provider',
    width: 150,
    render: (m) => (
      <XStack items="center" gap="$2">
        <ProviderLogo provider={m.provider ?? 'Other'} size={20} />
        <Text fontSize="$3" color="$color11" numberOfLines={1}>{displayProvider(m.provider)}</Text>
      </XStack>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 116,
    render: (m) =>
      m.available ? <Pill label="● Available" tone="live" /> : <Pill label="Catalog" />,
  },
]

const Stat = ({ label, value }: { label: string; value: string }) => (
  <YStack flex={1} gap={2} px="$3" py="$2.5">
    <Text fontSize="$6" fontWeight="700" color="$color12">
      {value}
    </Text>
    <Text fontSize="$1" color="$color10">
      {label}
    </Text>
  </YStack>
)

/** A labelled fact cell for the detail grid. */
const Fact = ({ label, value }: { label: string; value: string }) => (
  <YStack gap={2} minW={130}>
    <Text fontSize="$1" color="$color10">
      {label}
    </Text>
    <Text fontSize="$3" color="$color12">
      {value}
    </Text>
  </YStack>
)

/** One subscription-tier badge (resolved from the model's `tier` via /v1/plans). */
function PlanBadge({ plan }: { plan: Plan }) {
  const rpm = plan.limits?.requestsPerMinute
  const tpm = plan.limits?.tokensPerMinute
  const limit =
    rpm && tpm ? `${rpm.toLocaleString()} rpm · ${(tpm / 1000).toLocaleString()}k tpm`
    : rpm ? `${rpm.toLocaleString()} rpm`
    : tpm ? `${(tpm / 1000).toLocaleString()}k tpm`
    : null
  return (
    <YStack px="$2.5" py="$1.5" rounded="$3" bg="$color3" gap={1}>
      <Text fontSize="$2" fontWeight="700" color="$color12">{plan.name}</Text>
      {limit ? <Text fontSize="$1" color="$color10">{limit}</Text> : null}
    </YStack>
  )
}

/** Click-through model detail — full specs, pricing, features, and config actions. */
function ModelDetailPanel({ m, plans, onBack }: { m: CatalogEntry; plans: Plan[]; onBack: () => void }) {
  const router = useRouter()
  const tierPlans = plansForTier(m.tier, plans)
  const copyId = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(m.id ?? m.name)
  }
  return (
    <YStack gap="$4">
      <XStack items="center" gap="$2">
        <Button size="$2" chromeless icon={<ArrowLeft size={16} />} onPress={onBack}>
          Catalog
        </Button>
      </XStack>

      <YStack gap="$2">
        <XStack items="center" gap="$3" flexWrap="wrap">
          <ProviderLogo provider={m.provider ?? 'Other'} size={40} />
          <Text fontSize="$8" fontWeight="800" color="$color12">
            {modelDisplayName(m)}
          </Text>
          {m.specs?.params ? <Pill label={m.specs.params} /> : null}
          {m.available ? <Pill label="● Available" tone="live" /> : <Pill label="Catalog" />}
        </XStack>
        {m.fullName ? (
          <Text fontSize="$4" color="$color11">
            {m.fullName}
          </Text>
        ) : null}
        {m.description ? (
          <Text fontSize="$3" color="$color10">
            {m.description}
          </Text>
        ) : null}
      </YStack>

      <XStack gap="$2" flexWrap="wrap">
        <Button size="$3" icon={<Play size={15} />} onPress={() => router.push('/playground')}>
          Open in Playground
        </Button>
        <Button
          size="$3"
          icon={<Settings2 size={15} />}
          onPress={() => router.push(`/models/routing/${encodeURIComponent(m.id ?? m.name)}`)}
        >
          Configure routing
        </Button>
        <Button size="$3" chromeless icon={<Copy size={15} />} onPress={copyId}>
          Copy ID
        </Button>
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
        <Fact label="Type" value={modelType(m)} />
        <Fact label="Provider" value={displayProvider(m.provider)} />
        <Fact label="Context" value={fmtContext(modelContext(m))} />
        <Fact label="Tier" value={m.tier ? m.tier : '—'} />
        <Fact label="Input / Mtok" value={fmtPrice(m.pricing?.input)} />
        <Fact label="Output / Mtok" value={fmtPrice(m.pricing?.output)} />
        <Fact label="Cache read / Mtok" value={fmtPrice(m.pricing?.cacheRead)} />
        <Fact label="Cache write / Mtok" value={fmtPrice(m.pricing?.cacheWrite)} />
        {m.specs?.arch ? <Fact label="Architecture" value={m.specs.arch} /> : null}
      </XStack>

      {tierPlans.length > 0 ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11" fontWeight="600">
            Included in plans
          </Text>
          <XStack gap="$2" flexWrap="wrap">
            {tierPlans.map((p) => (
              <PlanBadge key={p.id} plan={p} />
            ))}
          </XStack>
        </YStack>
      ) : null}

      {m.features && m.features.length > 0 ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11" fontWeight="600">
            Features
          </Text>
          <XStack gap="$1.5" flexWrap="wrap">
            {m.features.map((f) => (
              <Text key={f} fontSize="$2" px="$2.5" py="$1" rounded="$3" bg="$color3" color="$color11">
                {f}
              </Text>
            ))}
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  )
}

/** A labelled row of selectable pills (one active at a time, or none). */
function FilterPills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { key: T; label: string }[]
  value: T | null
  onChange: (v: T | null) => void
}) {
  if (options.length === 0) return null
  return (
    <YStack gap="$1.5">
      <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
        {label}
      </Text>
      <XStack gap="$1" flexWrap="wrap">
        <Button
          size="$2"
          bg={value === null ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={() => onChange(null)}
        >
          All
        </Button>
        {options.map((o) => (
          <Button
            key={o.key}
            size="$2"
            bg={value === o.key ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => onChange(o.key)}
          >
            {o.label}
          </Button>
        ))}
      </XStack>
    </YStack>
  )
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; models: CatalogEntry[] }

export function ModelCatalogModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [plans, setPlans] = useState<Plan[]>([])
  const [selected, setSelected] = useState<CatalogEntry | null>(null)

  // Filters (client-side over the loaded catalog).
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [price, setPrice] = useState<PriceBucket | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    fetchCatalog()
      .then((models) => setState({ phase: 'ready', models }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
    // Plans are enrichment (tier badges); honest-empty on gate, never blocks.
    fetchPlans().then(setPlans)
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const models = state.phase === 'ready' ? state.models : []

  // Filter options derived from the loaded catalog.
  const providers = useMemo(() => {
    const set = new Set<string>()
    for (const m of models) set.add(displayProvider(m.provider))
    return Array.from(set)
      .sort((a, b) => (a === 'Zen' ? -1 : b === 'Zen' ? 1 : a.localeCompare(b)))
      .map((p) => ({ key: p, label: p }))
  }, [models])

  const types = useMemo(() => modelTypes(models).map((t) => ({ key: t, label: t })), [models])

  const rows = useMemo(
    () =>
      models.filter(
        (m) =>
          matchesQuery(m, query) &&
          (provider ? displayProvider(m.provider) === provider : true) &&
          (type ? modelType(m) === type : true) &&
          (price ? priceBucket(m) === price : true),
      ),
    [models, query, provider, type, price],
  )

  const activeFilters = (provider ? 1 : 0) + (type ? 1 : 0) + (price ? 1 : 0)
  const clearAll = () => {
    setProvider(null)
    setType(null)
    setPrice(null)
  }

  const stats = useMemo(() => {
    const ctxs = rows.map((m) => modelContext(m)).filter((x): x is number => typeof x === 'number')
    const ins = rows.map((m) => m.pricing?.input).filter((x): x is number => typeof x === 'number')
    const provCount = new Set(rows.map((m) => displayProvider(m.provider))).size
    const avgIn = ins.length ? ins.reduce((a, b) => a + b, 0) / ins.length : null
    return {
      total: String(rows.length),
      ctx: ctxs.length ? `${fmtContext(Math.min(...ctxs))} – ${fmtContext(Math.max(...ctxs))}` : '—',
      avg: avgIn != null ? `$${avgIn.toFixed(2)}` : '—',
      providers: String(provCount),
    }
  }, [rows])

  // Click-through detail — full specs/pricing/features + config actions.
  if (selected) {
    return <ModelDetailPanel m={selected} plans={plans} onBack={() => setSelected(null)} />
  }

  return (
    <>
      <PageHeader
        title="Model Catalog"
        subtitle="Explore and deploy the best open AI models. All models are routeable and usage-based."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            <Button size="$2" chromeless icon={<Boxes size={15} />} onPress={() => router.push('/providers')}>
              Providers
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <ErrorState
          err={state.err}
          onRetry={run}
          copy={{
            notFound:
              'The model catalog (/v1/pricing/models) is not routed on this host yet. It appears automatically once the deployment proxies it through the gateway.',
          }}
        />
      ) : (
        <>
          {/* Search + Filters affordance */}
          <XStack gap="$2" items="center" flexWrap="wrap">
            <XStack
              flex={1}
              minW={240}
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
                placeholder="Search models, providers, descriptions…"
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
              />
              {query ? (
                <Button size="$1" chromeless circular icon={<X size={13} />} onPress={() => setQuery('')} />
              ) : null}
            </XStack>
            <Button
              size="$2"
              icon={<SlidersHorizontal size={15} />}
              bg={showFilters || activeFilters > 0 ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => setShowFilters((v) => !v)}
            >
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ''}
            </Button>
          </XStack>

          {showFilters ? (
            <YStack gap="$3" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color1">
              <FilterPills label="Provider" options={providers} value={provider} onChange={setProvider} />
              <FilterPills label="Type" options={types} value={type} onChange={setType} />
              <FilterPills label="Pricing" options={PRICE_BUCKETS} value={price} onChange={setPrice} />
              {activeFilters > 0 ? (
                <Button size="$2" chromeless self="flex-start" icon={<X size={14} />} onPress={clearAll}>
                  Clear filters
                </Button>
              ) : null}
            </YStack>
          ) : null}

          <DataTable
            columns={columns}
            rows={rows}
            loading={state.phase === 'loading'}
            rowKey={(m) => m.id ?? m.name}
            onRowPress={(m) => setSelected(m)}
            empty={
              query || activeFilters > 0
                ? 'No models match your search and filters.'
                : 'No models available on this deployment yet.'
            }
          />

          {state.phase === 'ready' && rows.length > 0 ? (
            <XStack
              rounded="$4"
              borderWidth={1}
              borderColor="$borderColor"
              bg="$color1"
              mt="$2"
              flexWrap="wrap"
            >
              <Stat label="Total models" value={stats.total} />
              <Stat label="Context range" value={stats.ctx} />
              <Stat label="Avg. input / Mtok" value={stats.avg} />
              <Stat label="Providers" value={stats.providers} />
            </XStack>
          ) : null}
        </>
      )}
    </>
  )
}
