'use client'

/**
 * Embeddings · Overview — the at-a-glance board, all from real data with honest
 * gaps. The five metric cards read the cloud-usage read API (absent today → "—",
 * no fabricated sparkline); the donut is the org's real collection-by-model mix;
 * the dimension bars light up when metering reports per-dimension counts; the
 * index-health list is per-collection state enriched with live `/v1/search/stats`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes } from '@hanzogui/lucide-icons-2'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { EmbeddingsApi } from '~/lib/api/embeddings'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { EmptyState } from '~/components/ui/EmptyState'
import { Sparkline, Donut, BarChart } from '~/components/ui/Charts'
import { emptyUsages, modelShares, type Collection, type CloudUsages, type UsageMetric } from './logic'

const fmtInt = (n: number) => n.toLocaleString()
const fmtMs = (n: number) => `${Math.round(n)} ms`
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`
const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
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

function Delta({ pct }: { pct: number }) {
  const up = pct >= 0
  return (
    <Text fontSize="$1" color={up ? '$green10' : '$red10'}>
      {up ? '↑' : '↓'} {Math.abs(Math.round(pct * 100))}% vs 7d
    </Text>
  )
}

function MetricCard({ label, metric, fmt }: { label: string; metric: UsageMetric; fmt: (n: number) => string }) {
  return (
    <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" flex={1} minW={180}>
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <XStack justify="space-between" items="flex-end" gap="$2">
        <Text fontSize="$8" fontWeight="900" color={metric.value != null ? '$color12' : '$color10'}>
          {metric.value != null ? fmt(metric.value) : '—'}
        </Text>
        {metric.series ? <Sparkline values={metric.series} /> : null}
      </XStack>
      {metric.deltaPct != null ? (
        <Delta pct={metric.deltaPct} />
      ) : (
        <Text fontSize="$1" color="$color10">
          {metric.value != null ? ' ' : 'Awaiting metering'}
        </Text>
      )}
    </Card>
  )
}

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
}: {
  owner: string
  onOpenCollection: (name: string) => void
  onNew: () => void
  onExplore: () => void
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

  const cards = useMemo(
    () => [
      { label: 'Total vectors', metric: usage.vectors, fmt: fmtInt },
      { label: 'Storage used', metric: usage.storageBytes, fmt: fmtBytes },
      { label: 'Queries (7D)', metric: usage.queries, fmt: fmtInt },
      { label: 'Avg latency', metric: usage.latencyMs, fmt: fmtMs },
      { label: 'Cost (7D)', metric: usage.costCents, fmt: usd },
    ],
    [usage],
  )

  const usingRealModelVectors = usage.models.length > 0
  const modelData = usingRealModelVectors ? usage.models : modelShares(collections)
  const centerLabel = usingRealModelVectors
    ? `${modelData.reduce((a, s) => a + s.value, 0)}`
    : `${collections.length}`

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
  if (collections.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="Create your first collection"
        description="A collection is a vector index for one knowledge base — ingest documents, embed them, and search by meaning. Each collection maps to the Qdrant/Search index {org}-{name}-docs."
        bullets={[
          'Create a collection, then ingest from upload, GitHub, crawl, or S3',
          'Embeddings are generated with a Zen embedding model',
          'Query it from the Explore tab or the /v1/search API',
        ]}
        primary={{ label: 'Create collection', onPress: onNew }}
        secondary={{ label: 'Try search', onPress: onExplore }}
      />
    )
  }

  return (
    <YStack gap="$4">
      {/* ── Metric cards ─────────────────────────────────────────────────── */}
      <XStack flexWrap="wrap" gap="$3">
        {cards.map((c) => (
          <MetricCard key={c.label} label={c.label} metric={c.metric} fmt={c.fmt} />
        ))}
      </XStack>

      {/* ── Model mix + dimensions ───────────────────────────────────────── */}
      <XStack flexWrap="wrap" gap="$3">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={320}>
          <Text fontSize="$5" fontWeight="800" color="$color12">
            {usingRealModelVectors ? 'Vectors by model' : 'Collections by model'}
          </Text>
          <Donut slices={modelData} centerLabel={centerLabel} />
        </Card>

        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={320}>
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Vector dimensions
          </Text>
          <BarChart bars={usage.dimensions} />
          {usage.dimensions.length === 0 ? (
            <Text fontSize="$2" color="$color10">
              Per-dimension counts appear once metering reports them.
            </Text>
          ) : null}
        </Card>
      </XStack>

      {/* ── Index health ─────────────────────────────────────────────────── */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
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
              hoverStyle={{ bg: '$color2' }}
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
    </YStack>
  )
}
