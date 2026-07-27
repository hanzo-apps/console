'use client'

/**
 * Embeddings · Overview — the polished landing, composed from the shared `ProductLanding`
 * kit (hero + live count-up metrics + interactive `POST /v1/embeddings` code samples +
 * resources rail), so it reads as nicely as the Inference dashboard. The product's own
 * REAL content is preserved as the landing's children: the collection-by-model mix donut,
 * the per-dimension bars, and the per-collection index-health list.
 *
 * Every number is real or an honest "—": Collections is the live store count, Documents
 * is summed from live `/v1/search/stats`, and the vectors/queries/latency/cost metrics
 * read the cloud-usage read API (absent today → "—", no fabricated sparkline).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, DollarSign, FileText, Gauge, Layers, Plus, Search, Sparkles } from '@hanzogui/lucide-icons-2'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { config } from '~/config'
import { EmbeddingsApi } from '~/lib/api/embeddings'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { EmptyState } from '~/components/ui/EmptyState'
import { Donut, BarRows } from '~/components/ui/Charts'
import { ProductLanding, apiBaseFromDocs, type LandingMetric, type ProductLandingConfig } from '~/components/products/landing'
import {
  defaultEmbeddingModel,
  embeddingsCodeSamples,
  emptyUsages,
  modelShares,
  type Collection,
  type CloudUsages,
} from './logic'

const fmtInt = (n: number) => Math.round(n).toLocaleString()
const fmtMs = (n: number) => `${Math.round(n)} ms`
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`
const fmtBytes = (n: number): string => {
  if (n < 1024) return `${Math.round(n)} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${u[i]}`
}

/** Per-collection live status for the health list. */
type Health = { collection: Collection; documentCount?: number; status: string }

function statusTone(s: string): '$green10' | '$yellow10' | '$color11' {
  if (s === 'Healthy') return '$green10'
  if (s === 'Rebuilding') return '$yellow10'
  return '$color11'
}

export function OverviewView({
  owner,
  onOpenCollection,
  onNew,
  onExplore,
  onGenerate,
}: {
  owner: string
  onOpenCollection: (name: string) => void
  onNew: () => void
  onExplore: () => void
  onGenerate: () => void
}) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [usage, setUsage] = useState<CloudUsages>(emptyUsages())
  const [health, setHealth] = useState<Health[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cols = await EmbeddingsApi.collections(owner)
      setCollections(cols)
      // Usage is the forward-compatible read API — degrade silently to "—".
      EmbeddingsApi.cloudUsages(7)
        .then(setUsage)
        .catch(() => setUsage(emptyUsages()))
      // Per-collection live index stats — best-effort, never blocks the page.
      Promise.all(
        cols.map(async (c) => {
          const s = await EmbeddingsApi.indexStats(c.name)
          return {
            collection: c,
            documentCount: s.documentCount,
            status: s.isIndexing ? 'Rebuilding' : c.status,
          }
        }),
      ).then(setHealth)
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
  }, [load])

  // Sum of live indexed documents across collections (REAL) — else "—" until stats load.
  const documentsIndexed = useMemo(() => {
    const counts = health.map((h) => h.documentCount).filter((n): n is number => typeof n === 'number')
    return counts.length ? counts.reduce((a, b) => a + b, 0) : null
  }, [health])

  const metrics: LandingMetric[] = useMemo(
    () => [
      { key: 'collections', label: 'Collections', value: collections.length, format: fmtInt, icon: <Boxes size={14} opacity={0.6} /> },
      {
        key: 'documents',
        label: 'Documents indexed',
        value: documentsIndexed,
        format: fmtInt,
        icon: <FileText size={14} opacity={0.6} />,
        hint: documentsIndexed == null ? 'Live from the index' : undefined,
      },
      {
        key: 'vectors',
        label: 'Total vectors',
        value: usage.vectors.value ?? null,
        format: fmtInt,
        series: usage.vectors.series,
        deltaPct: usage.vectors.deltaPct ?? undefined,
        icon: <Layers size={14} opacity={0.6} />,
        hint: usage.vectors.value == null ? 'Awaiting metering' : undefined,
      },
      {
        key: 'queries',
        label: 'Queries (7D)',
        value: usage.queries.value ?? null,
        format: fmtInt,
        series: usage.queries.series,
        deltaPct: usage.queries.deltaPct ?? undefined,
        icon: <Search size={14} opacity={0.6} />,
        hint: usage.queries.value == null ? 'Awaiting metering' : undefined,
      },
      {
        key: 'latency',
        label: 'Avg latency',
        value: usage.latencyMs.value ?? null,
        format: fmtMs,
        series: usage.latencyMs.series,
        deltaPct: usage.latencyMs.deltaPct ?? undefined,
        icon: <Gauge size={14} opacity={0.6} />,
        hint: usage.latencyMs.value == null ? 'Awaiting metering' : undefined,
      },
      {
        key: 'cost',
        label: 'Cost (7D)',
        value: usage.costCents.value ?? null,
        format: usd,
        series: usage.costCents.series,
        deltaPct: usage.costCents.deltaPct ?? undefined,
        icon: <DollarSign size={14} opacity={0.6} />,
        hint: usage.costCents.value == null ? 'Awaiting metering' : undefined,
      },
    ],
    [collections.length, documentsIndexed, usage],
  )

  const samples = useMemo(
    () => embeddingsCodeSamples(apiBaseFromDocs(config.docsUrl), defaultEmbeddingModel(collections)),
    [collections],
  )

  const landingConfig: ProductLandingConfig = useMemo(
    () => ({
      productId: 'embeddings',
      title: 'Vector embeddings & semantic search',
      tagline:
        'Generate, store, and search embeddings at scale — one API for semantic search and RAG, powered by Zen embedding models.',
      icon: Boxes,
      docsProduct: 'embeddings',
      primary: { label: 'Create collection', icon: <Plus size={16} />, onPress: onNew },
      secondary: { label: 'Try search', icon: <Search size={15} />, onPress: onExplore },
      metrics,
      samples,
      run: { label: 'Generate in console', icon: <Sparkles size={14} />, onPress: onGenerate },
      actions: [
        { label: 'Create collection', icon: <Plus size={15} />, onPress: onNew },
        { label: 'Explore search', icon: <Search size={15} />, onPress: onExplore },
        { label: 'Generate embeddings', icon: <Sparkles size={15} />, onPress: onGenerate },
      ],
    }),
    [metrics, samples, onNew, onExplore, onGenerate],
  )

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (error) {
    return <BackendStateCard state={error} onRetry={() => void load()} hint="endpoint · GET /v1/get-stores" />
  }

  return (
    <ProductLanding config={landingConfig}>
      {collections.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Create your first collection"
          description="A collection is a vector index for one knowledge base — ingest documents, embed them, and search by meaning. Each collection maps to the Vector/Search index {org}-{name}-docs."
          bullets={[
            'Create a collection, then ingest from upload, GitHub, crawl, or S3',
            'Embeddings are generated with a Zen embedding model',
            'Query it from the Explore tab or the /v1/search API',
          ]}
          primary={{ label: 'Create collection', onPress: onNew }}
          secondary={{ label: 'Try search', onPress: onExplore }}
        />
      ) : (
        <>
          <ModelAndDimensions usage={usage} collections={collections} />
          <IndexHealth health={health} onOpenCollection={onOpenCollection} />
        </>
      )}
    </ProductLanding>
  )
}

/** The collection-by-model donut + the per-dimension bars (REAL counts / honest empty). */
function ModelAndDimensions({ usage, collections }: { usage: CloudUsages; collections: Collection[] }) {
  const usingRealModelVectors = usage.models.length > 0
  const modelData = usingRealModelVectors ? usage.models : modelShares(collections)
  const centerLabel = usingRealModelVectors ? `${modelData.reduce((a, s) => a + s.value, 0)}` : `${collections.length}`

  return (
    <XStack flexWrap="wrap" gap="$3">
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" flex={1} minW={320}>
        <Text fontSize="$5" fontWeight="800" color="$color12">
          {usingRealModelVectors ? 'Vectors by model' : 'Collections by model'}
        </Text>
        <Donut
          slices={modelData}
          center={
            <Text fontSize="$7" fontWeight="900" color="$color12">
              {centerLabel}
            </Text>
          }
          legend
        />
      </Card>

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" flex={1} minW={320}>
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Vector dimensions
        </Text>
        <BarRows bars={usage.dimensions} />
        {usage.dimensions.length === 0 ? (
          <Text fontSize="$2" color="$color10">
            Per-dimension counts appear once metering reports them.
          </Text>
        ) : null}
      </Card>
    </XStack>
  )
}

/** Per-collection index health — status dot + live doc count, clickable to the editor. */
function IndexHealth({ health, onOpenCollection }: { health: Health[]; onOpenCollection: (name: string) => void }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <Text fontSize="$5" fontWeight="800" color="$color12">
        Index health
      </Text>
      <YStack gap="$1">
        {health.map((h) => (
          <XStack
            key={`${h.collection.owner}/${h.collection.name}`}
            py="$2"
            gap="$3"
            items="center"
            borderTopWidth={1}
            borderColor="$borderColor"
            hoverStyle={{ bg: '$color3' }}
            cursor="pointer"
            onPress={() => onOpenCollection(h.collection.name)}
          >
            <YStack width={8} height={8} rounded="$10" bg={statusTone(h.status)} />
            <Text fontSize="$3" color="$color12" flex={1} numberOfLines={1}>
              {h.collection.name}
            </Text>
            <Text fontSize="$2" color="$color11" width={140} numberOfLines={1}>
              {h.documentCount != null ? `${fmtInt(h.documentCount)} docs` : '—'}
            </Text>
            <Text fontSize="$2" color={statusTone(h.status)} width={90}>
              {h.status}
            </Text>
          </XStack>
        ))}
      </YStack>
    </Card>
  )
}
