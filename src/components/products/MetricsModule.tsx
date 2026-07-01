'use client'

/**
 * Metrics — org-wide LLM & agent analytics (the Langfuse-style dashboard), native
 * on @hanzo/gui.
 *
 * ONE honest source: the org's REAL o11y rows — the SAME `/v1/o11y/{traces,
 * observations,scores}` surfaces the Traces / Observations / Scores lists read.
 * The o11y client stamps `X-Org-Id` (`currentOrg()`) on every call and only adds
 * `X-Project-Id` when a project is selected, so this dashboard is
 * ORGANISATION-WIDE on login (no project required) and narrows to a project the
 * moment one is picked in the scope switcher. Every KPI, series, and bar is a pure
 * fold over rows the backend returned (`observability/metrics.ts`) — nothing is
 * fabricated. When the o11y runtime is not initialized (503) or unrouted (404) it
 * shows the SAME honest `RuntimeNotice` as every other observability surface.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, BarChart3, CreditCard, Gauge, RefreshCw } from '@hanzogui/lucide-icons-2'

import {
  O11yApi,
  type Observation,
  type O11yList,
  type Score,
  type Trace,
} from '~/lib/api'
import { useScope } from '~/lib/scope-context'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { MetricCard, Panel } from '~/components/ui/Metric'
import { LineChart, BarRows } from '~/components/ui/Charts'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { fmtLatency } from './observability/format'
import {
  METRICS_RANGE_DAYS,
  dailySeries,
  modelBreakdown,
  observationAt,
  scoreAt,
  scoreSummary,
  totals,
  traceAt,
  withinRange,
  type MetricsRange,
  type ScoreMetric,
} from './observability/metrics'

/** How many recent rows to pull per surface for the aggregate (one page, bounded). */
const SAMPLE = 1000
const RANGES: MetricsRange[] = ['24h', '7d', '30d']

const emptyList = <T,>(): O11yList<T> => ({ data: [], meta: { page: 1, limit: SAMPLE, totalItems: 0, totalPages: 0 } })

type Data = { traces: Trace[]; observations: Observation[]; scores: Score[]; totalTraces: number }
type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; data: Data }

/** Compact money for a window total (honest 4-dp for sub-cent sums). */
const fmtUsd = (n: number): string => (n <= 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
/** Compact token count (1.2k / 3.4M) for a KPI tile. */
const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)
const fmtInt = (n: number): string => n.toLocaleString()

export function MetricsModule(_props: { params: Record<string, string> }) {
  const { scope } = useScope()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [range, setRange] = useState<MetricsRange>('7d')

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      // Traces are the gate — a 503/404 here is the real runtime state, surfaced
      // honestly for the whole page. Observations + scores are secondary: a
      // per-surface failure degrades that section to empty rather than blanking
      // the working KPIs (same honest-per-surface stance as the list modules).
      const traces = await O11yApi.traces({ limit: SAMPLE })
      const [observations, scores] = await Promise.all([
        O11yApi.observations({ limit: SAMPLE }).catch(() => emptyList<Observation>()),
        O11yApi.scores({ limit: SAMPLE }).catch(() => emptyList<Score>()),
      ])
      setState({
        phase: 'ready',
        data: {
          traces: traces.data ?? [],
          observations: observations.data ?? [],
          scores: scores.data ?? [],
          totalTraces: traces.meta?.totalItems ?? (traces.data ?? []).length,
        },
      })
    } catch (e) {
      setState({ phase: 'error', error: e })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const derived = useMemo(() => {
    if (state.phase !== 'ready') return null
    const now = Date.now()
    const { traces, observations, scores } = state.data
    const tracesIn = withinRange(traces, traceAt, range, now)
    const obsIn = withinRange(observations, observationAt, range, now)
    const scoresIn = withinRange(scores, scoreAt, range, now)
    return {
      kpi: totals(tracesIn, obsIn),
      traceSeries: dailySeries(tracesIn, traceAt, () => 1, range, now),
      costSeries: dailySeries(tracesIn, traceAt, (t) => (typeof t.totalCost === 'number' ? t.totalCost : 0), range, now),
      models: modelBreakdown(obsIn).slice(0, 8),
      scores: scoreSummary(scoresIn),
    }
  }, [state, range])

  const scopeNote = scope.project ? `Project: ${scope.project}` : 'Organization-wide · all projects'

  const rangeSelector = (
    <XStack gap="$1">
      {RANGES.map((r) => (
        <Button
          key={r}
          size="$2"
          bg={r === range ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={() => setRange(r)}
        >
          {r}
        </Button>
      ))}
    </XStack>
  )

  return (
    <>
      <PageHeader
        title="Metrics"
        subtitle="LLM and agent analytics across your organization."
        actions={
          <XStack gap="$2" items="center">
            {rangeSelector}
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <RuntimeNotice surface="metrics" error={state.error} />
      ) : state.phase === 'loading' || !derived ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading metrics…</Text>
        </XStack>
      ) : state.data.traces.length === 0 ? (
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={680}>
          <Text fontSize="$4" fontWeight="700">
            No traces yet
          </Text>
          <Text fontSize="$3" color="$color11">
            Metrics appear here once your workloads send traces to the observability runtime. This dashboard
            aggregates your organization&apos;s real traces, spend, tokens, latency, model mix, and scores — it never
            shows placeholder data.
          </Text>
          <Text fontSize="$2" color="$color10">
            {scopeNote}
          </Text>
        </Card>
      ) : (
        <YStack gap="$4">
          <Text fontSize="$2" color="$color10">
            {scopeNote} · aggregated over your {fmtInt(state.data.traces.length)} most recent traces
            {state.data.totalTraces > state.data.traces.length ? ` (of ${fmtInt(state.data.totalTraces)})` : ''}, last{' '}
            {METRICS_RANGE_DAYS[range]}d.
          </Text>

          {/* KPI tiles — all folded from real rows; empty windows read honest zeros. */}
          <XStack gap="$3" flexWrap="wrap">
            <MetricCard
              icon={<Activity size={16} />}
              label="Traces"
              value={fmtInt(derived.kpi.traces)}
              spark={derived.traceSeries.map((p) => p.value)}
            />
            <MetricCard
              icon={<CreditCard size={16} />}
              label="Spend"
              value={fmtUsd(derived.kpi.cost)}
              spark={derived.costSeries.map((p) => p.value)}
              sparkColor="#23c562"
            />
            <MetricCard
              icon={<Gauge size={16} />}
              label="Avg latency"
              value={fmtLatency(derived.kpi.avgLatency)}
              caption={`p95 ${fmtLatency(derived.kpi.p95Latency)}`}
            />
            <MetricCard icon={<BarChart3 size={16} />} label="Tokens" value={fmtTokens(derived.kpi.tokens)} />
          </XStack>

          {/* Time series — dense per-day (zero-filled), so gaps read honestly. */}
          <XStack gap="$4" flexWrap="wrap">
            <Panel title="Traces over time">
              <LineChart data={derived.traceSeries} formatValue={(v) => fmtInt(Math.round(v))} />
            </Panel>
            <Panel title="Spend over time">
              <LineChart data={derived.costSeries} color="#23c562" formatValue={fmtUsd} />
            </Panel>
          </XStack>

          {/* Distributions — model mix (observations) + a score rollup. */}
          <XStack gap="$4" flexWrap="wrap">
            <Panel title="Top models" minW={320}>
              {derived.models.length > 0 ? (
                <BarRows bars={derived.models.map((m) => ({ label: m.model, value: m.observations }))} />
              ) : (
                <Text fontSize="$3" color="$color10">
                  No model observations in this window.
                </Text>
              )}
            </Panel>
            <Panel title="Scores" minW={320}>
              <ScoreTable rows={derived.scores} />
            </Panel>
          </XStack>
        </YStack>
      )}
    </>
  )
}

/** The per-name score rollup — count and (numeric) mean, honest em-dash otherwise. */
function ScoreTable({ rows }: { rows: ScoreMetric[] }) {
  const columns: Column<ScoreMetric>[] = [
    { key: 'name', header: 'Score', render: (s) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{s.name}</Text> },
    {
      key: 'dataType',
      header: 'Type',
      width: 130,
      render: (s) => (
        <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
          {s.dataType}
        </Text>
      ),
    },
    { key: 'count', header: 'Count', width: 90, render: (s) => <Text fontSize="$3" color="$color11">{s.count}</Text> },
    {
      key: 'average',
      header: 'Avg',
      width: 90,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {s.average === null ? '—' : s.average.toFixed(2)}
        </Text>
      ),
    },
  ]
  return <DataTable columns={columns} rows={rows} rowKey={(s) => s.name} empty="No scores in this window." />
}
