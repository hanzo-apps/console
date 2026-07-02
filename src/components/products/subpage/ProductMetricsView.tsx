'use client'

/**
 * Per-product Metrics — REAL, per-org, two honest feeds (see `sources.ts`):
 *
 *  - AI/LLM products (`metrics: 'o11y'`) render the SAME real org trace analytics
 *    the Metrics product shows (traces/tokens/latency/spend/model-mix/scores) —
 *    reused verbatim (`MetricsModule`), no duplication, no fabrication.
 *  - Every other product (`metrics: 'usage'`) reads the commerce usage ledger
 *    filtered to THIS product's tag (`metadata.product`) — real per-product
 *    spend/requests/tokens, honest-empty until cloud attributes spend to it.
 *
 * Nothing is fabricated: an empty window reads honest zeros / an em dash, and a
 * product with no attributed spend shows a truthful "no metrics attributed yet".
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, BarChart3, CreditCard, RefreshCw } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import {
  fetchUsageRecords,
  withinRange,
  totalsOf,
  dailySeries,
  perModel,
  RANGE_DAYS,
  type RangeKey,
  type UsageRecord,
} from '~/lib/api/aimetrics'
import { ApiError } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard, Panel } from '~/components/ui/Metric'
import { LineChart, BarRows } from '~/components/ui/Charts'
import { MetricsModule } from '../MetricsModule'
import { subpageSourcesFor } from './sources'

const RANGES: RangeKey[] = ['24h', '7d', '30d']

const fmtUsd = (cents: number): string => {
  const n = cents / 100
  return n <= 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}
const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)
const fmtInt = (n: number): string => n.toLocaleString()

type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; records: UsageRecord[] }

/** Usage-ledger metrics scoped to ONE product's tag — real per-product spend. */
function UsageMetrics({ entry }: { entry: CatalogEntry }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [range, setRange] = useState<RangeKey>('7d')

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    fetchUsageRecords()
      .then((records) => setState({ phase: 'ready', records: records.filter((r) => r.product === entry.id) }))
      .catch((e) => setState({ phase: 'error', error: e }))
  }, [entry.id])

  useEffect(() => {
    load()
  }, [load])

  const derived = useMemo(() => {
    if (state.phase !== 'ready') return null
    const now = Date.now()
    const inRange = withinRange(state.records, range, now)
    return {
      totals: totalsOf(inRange),
      series: dailySeries(inRange, range, now),
      models: perModel(inRange).slice(0, 8),
      count: inRange.length,
    }
  }, [state, range])

  const rangeSelector = (
    <XStack gap="$1">
      {RANGES.map((r) => (
        <Button key={r} size="$2" bg={r === range ? '$color5' : 'transparent'} borderWidth={1} borderColor="$borderColor" onPress={() => setRange(r)}>
          {r}
        </Button>
      ))}
    </XStack>
  )

  return (
    <>
      <PageHeader
        title={`${entry.label} · Metrics`}
        subtitle={`Usage and spend attributed to ${entry.label}, per organization.`}
        actions={
          <XStack gap="$2" items="center">
            {rangeSelector}
            <Button icon={<RefreshCw size={16} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <ErrorCard error={state.error} entry={entry} />
      ) : state.phase === 'loading' || !derived ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading metrics…</Text>
        </XStack>
      ) : derived.count === 0 ? (
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={680}>
          <Text fontSize="$4" fontWeight="700">No metrics attributed yet</Text>
          <Text fontSize="$3" color="$color11">
            No spend or usage has been attributed to {entry.label} in the last {RANGE_DAYS[range]}d for your
            organization. This dashboard reads your real commerce usage ledger, filtered to {entry.label} —
            it lights up the moment {entry.label} usage is charged, and never shows placeholder data.
          </Text>
        </Card>
      ) : (
        <YStack gap="$4">
          <XStack gap="$3" flexWrap="wrap">
            <MetricCard icon={<Activity size={16} />} label="Requests" value={fmtInt(derived.totals.requests)} spark={derived.series.map((p) => p.requests)} />
            <MetricCard icon={<CreditCard size={16} />} label="Spend" value={fmtUsd(derived.totals.cents)} spark={derived.series.map((p) => p.cents)} sparkColor="#23c562" />
            <MetricCard icon={<BarChart3 size={16} />} label="Tokens" value={fmtTokens(derived.totals.totalTokens)} spark={derived.series.map((p) => p.tokens)} />
          </XStack>

          <XStack gap="$4" flexWrap="wrap">
            <Panel title="Requests over time" minW={320}>
              <LineChart data={derived.series.map((p) => ({ label: p.day, value: p.requests }))} formatValue={(v) => fmtInt(Math.round(v))} />
            </Panel>
            <Panel title="Spend over time" minW={320}>
              <LineChart data={derived.series.map((p) => ({ label: p.day, value: p.cents / 100 }))} color="#23c562" formatValue={(v) => fmtUsd(v * 100)} />
            </Panel>
          </XStack>

          <Panel title="Top models" minW={320}>
            {derived.models.length > 0 ? (
              <BarRows bars={derived.models.map((m) => ({ label: m.model || '—', value: m.requests }))} />
            ) : (
              <Text fontSize="$3" color="$color10">No model breakdown in this window.</Text>
            )}
          </Panel>
        </YStack>
      )}
    </>
  )
}

function ErrorCard({ error, entry }: { error: unknown; entry: CatalogEntry }) {
  const status = error instanceof ApiError ? error.status : 0
  const body =
    status === 401 || status === 403
      ? 'Sign in to view usage metrics for your organization.'
      : status === 404
        ? 'The usage ledger is not wired on this deployment yet. Metrics appear here automatically once it is.'
        : 'Could not load usage metrics. Retry, or check back shortly.'
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={640}>
      <Text fontSize="$4" fontWeight="700">{entry.label} metrics unavailable</Text>
      <Text fontSize="$3" color="$color11">{body}</Text>
    </Card>
  )
}

export function ProductMetricsView({ entry }: { entry: CatalogEntry }) {
  const { metrics } = subpageSourcesFor(entry)
  // AI/LLM products reuse the real org trace-analytics dashboard verbatim (DRY).
  if (metrics === 'o11y') return <MetricsModule params={{}} />
  return <UsageMetrics entry={entry} />
}
