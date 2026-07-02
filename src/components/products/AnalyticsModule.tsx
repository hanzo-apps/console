/**
 * Native Analytics — the per-org analytics module. Reads the unified ClickHouse
 * warehouse (datastore) through cloud-api `/v1/analytics/*` via the same-origin
 * `/cloud` bearer proxy, so every metric is scoped to the caller's own IAM org
 * (server-authoritative, from the Bearer owner) — the browser holds no datastore
 * credential. Two lenses, tabbed:
 *
 *   - Overview  — web/commerce headline + revenue/traffic series + top pages/referrers
 *                 (hanzo.events + the events_daily rollup).
 *   - Real-Time — last-5-minutes active sessions + live event feed (hanzo.events).
 *   - LLM       — token/cost/latency + per-model breakdown (hanzo.cloud_usage, live).
 *
 * Every number is a real query result. Empty is honest-empty ("—" / "no data yet"),
 * never fabricated. A missing/unwired warehouse surfaces the honest BackendStateCard.
 * See universe/docs/architecture/unified-analytics.md.
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  BarChart3,
  DollarSign,
  Eye,
  Radio,
  ShoppingCart,
  Sparkles,
  Users,
} from '@hanzogui/lucide-icons-2'

import {
  AnalyticsApi,
  type LLMModelRow,
  type LLMOverview,
  type Overview,
  type Range,
  type Realtime,
  type TimePoint,
  type TopRow,
} from '~/lib/api/analytics'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import {
  LineChart,
  Donut,
  CHART_PALETTE,
  type ChartPoint,
  type Slice,
} from '~/components/ui/Charts'
import { classifyBackend, BackendStateCard, type BackendState } from '~/components/ui/BackendState'
import { MetricCard } from './functions/parts'

// ── formatting (honest "—" for missing) ─────────────────────────────────────
const fmtInt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString()
const fmtUsd = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(1)}%`

const RANGES: Range[] = ['24h', '7d', '30d', '90d']

// ── tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: '', label: 'Overview', icon: BarChart3 },
  { id: 'realtime', label: 'Real-Time', icon: Radio },
  { id: 'llm', label: 'LLM', icon: Sparkles },
] as const

export function AnalyticsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = useMemo(() => {
    const t = params.tab ?? ''
    return TABS.some((x) => x.id === t) ? t : ''
  }, [params.tab])

  return (
    <YStack p="$6" gap="$5">
      <PageHeader
        title="Analytics"
        subtitle="Per-org web, commerce, and LLM analytics over the unified warehouse."
      />

      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id || 'overview'}
            size="$2"
            icon={t.icon}
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.id ? `/analytics/${t.id}` : '/analytics')}
          >
            {t.label}
          </Button>
        ))}
      </XStack>

      {tab === 'realtime' ? <RealtimeTab /> : tab === 'llm' ? <LLMTab /> : <OverviewTab />}
    </YStack>
  )
}

// ── a tiny range selector shared by tabs ─────────────────────────────────────
function RangeBar({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  return (
    <XStack gap="$1">
      {RANGES.map((r) => (
        <Button
          key={r}
          size="$1"
          bg={r === range ? '$color6' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={() => onChange(r)}
        >
          {r}
        </Button>
      ))}
    </XStack>
  )
}

// ── Overview (web/commerce) ──────────────────────────────────────────────────
type OverviewState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; overview: Overview; series: TimePoint[]; pages: TopRow[]; referrers: TopRow[] }

function OverviewTab() {
  const [range, setRange] = useState<Range>('30d')
  const [state, setState] = useState<OverviewState>({ phase: 'loading' })

  const load = useCallback(async (r: Range) => {
    setState({ phase: 'loading' })
    try {
      const [overview, series, pages, referrers] = await Promise.all([
        AnalyticsApi.overview(r),
        AnalyticsApi.timeseries(r),
        AnalyticsApi.topPages(r, 10),
        AnalyticsApi.topReferrers(r, 10),
      ])
      setState({ phase: 'ready', overview, series, pages, referrers })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void load(range)
  }, [load, range])

  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        <XStack justify="flex-end">
          <RangeBar range={range} onChange={setRange} />
        </XStack>
        <BackendStateCard state={state.error} hint={`GET /v1/analytics/overview`} />
      </YStack>
    )
  }

  const o = state.phase === 'ready' ? state.overview : null
  const series = state.phase === 'ready' ? state.series : []
  const chartData: ChartPoint[] = series.map((p) => ({ label: p.date, value: p.revenue }))
  const hasData = o != null && o.events > 0

  const topCols: Column<TopRow>[] = [
    { key: 'key', header: 'Path' },
    { key: 'count', header: 'Views', width: 90, render: (r) => fmtInt(r.count) },
  ]
  const refCols: Column<TopRow>[] = [
    { key: 'key', header: 'Referrer' },
    { key: 'count', header: 'Visitors', width: 90, render: (r) => fmtInt(r.count) },
  ]

  return (
    <YStack gap="$4">
      <XStack justify="flex-end">
        <RangeBar range={range} onChange={setRange} />
      </XStack>

      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <MetricCard icon={ShoppingCart} label="Orders" value={fmtInt(o?.orders)} sub={range} />
        <MetricCard icon={DollarSign} label="Revenue" value={fmtUsd(o?.revenue)} sub={range} />
        <MetricCard icon={Users} label="Customers" value={fmtInt(o?.visitors)} sub="unique" />
        <MetricCard icon={Eye} label="Visits" value={fmtInt(o?.pageviews)} sub="pageviews" />
        <MetricCard icon={Activity} label="Conversion" value={fmtPct(o?.conversion)} sub="orders/visitors" />
        <MetricCard icon={DollarSign} label="AOV" value={fmtUsd(o?.aov)} sub="avg order value" />
      </XStack>

      {!hasData ? (
        <Card p="$5" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="800" color="$color12">
            No web or commerce events yet
          </Text>
          <Text fontSize="$2" color="$color10">
            Install the tracking snippet or connect commerce to start collecting events for this
            organization. LLM usage is on the LLM tab. This shows real data only — nothing is
            fabricated.
          </Text>
        </Card>
      ) : (
        <>
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$4" fontWeight="800" color="$color12">
              Revenue
            </Text>
            <LineChart data={chartData} formatValue={(v) => fmtUsd(v)} />
          </Card>

          <XStack flexWrap="wrap" gap="$3" items="stretch">
            <Card flex={1} minW={320} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <Text fontSize="$3" fontWeight="800" color="$color12">
                Top pages
              </Text>
              <DataTable columns={topCols} rows={state.phase === 'ready' ? state.pages : []} rowKey={(r) => r.key} empty="No pageviews yet." />
            </Card>
            <Card flex={1} minW={320} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <Text fontSize="$3" fontWeight="800" color="$color12">
                Top referrers
              </Text>
              <DataTable columns={refCols} rows={state.phase === 'ready' ? state.referrers : []} rowKey={(r) => r.key} empty="No referrers yet." />
            </Card>
          </XStack>
        </>
      )}
    </YStack>
  )
}

// ── Real-Time ─────────────────────────────────────────────────────────────────
type RealtimeState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: Realtime }

function RealtimeTab() {
  const [state, setState] = useState<RealtimeState>({ phase: 'loading' })

  const load = useCallback(async () => {
    try {
      const data = await AnalyticsApi.realtime(50)
      setState({ phase: 'ready', data })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  // Live: poll every 5s (paused implicitly when the component unmounts).
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 5000)
    return () => clearInterval(id)
  }, [load])

  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} hint={`GET /v1/analytics/realtime`} />
  }

  const active = state.phase === 'ready' ? state.data.active : 0
  const feed = state.phase === 'ready' ? state.data.feed : []

  const cols: Column<(typeof feed)[number]>[] = [
    { key: 'event', header: 'Event', width: 120 },
    { key: 'urlPath', header: 'Path' },
    { key: 'referrer', header: 'Referrer', width: 140, render: (r) => r.referrer || '—' },
    { key: 'country', header: 'Country', width: 80, render: (r) => r.country || '—' },
    { key: 'browser', header: 'Browser', width: 100, render: (r) => r.browser || '—' },
  ]

  return (
    <YStack gap="$4">
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <MetricCard icon={Radio} label="Active now" value={fmtInt(active)} sub="sessions · last 5 min" />
      </XStack>
      <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$3" fontWeight="800" color="$color12">
          Live activity
        </Text>
        <DataTable
          columns={cols}
          rows={feed}
          rowKey={(r) => `--`}
          empty="No activity in the last 5 minutes."
        />
      </Card>
    </YStack>
  )
}

// ── LLM ────────────────────────────────────────────────────────────────────────
type LLMState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; overview: LLMOverview; models: LLMModelRow[] }

function LLMTab() {
  const [range, setRange] = useState<Range>('30d')
  const [state, setState] = useState<LLMState>({ phase: 'loading' })

  const load = useCallback(async (r: Range) => {
    setState({ phase: 'loading' })
    try {
      const [overview, models] = await Promise.all([AnalyticsApi.llmOverview(r), AnalyticsApi.llmModels(r, 20)])
      setState({ phase: 'ready', overview, models })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void load(range)
  }, [load, range])

  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        <XStack justify="flex-end">
          <RangeBar range={range} onChange={setRange} />
        </XStack>
        <BackendStateCard state={state.error} hint={`GET /v1/analytics/llm/overview`} />
      </YStack>
    )
  }

  const o = state.phase === 'ready' ? state.overview : null
  const models = state.phase === 'ready' ? state.models : []
  const slices: Slice[] = models.slice(0, 6).map((m, i) => ({
    label: m.model,
    value: m.requests,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }))

  const cols: Column<LLMModelRow>[] = [
    { key: 'model', header: 'Model' },
    { key: 'provider', header: 'Provider', width: 110, render: (r) => r.provider || '—' },
    { key: 'requests', header: 'Requests', width: 100, render: (r) => fmtInt(r.requests) },
    { key: 'tokens', header: 'Tokens', width: 110, render: (r) => fmtInt(r.tokens) },
    { key: 'cost', header: 'Cost', width: 100, render: (r) => fmtUsd(r.cost) },
  ]

  return (
    <YStack gap="$4">
      <XStack justify="flex-end">
        <RangeBar range={range} onChange={setRange} />
      </XStack>

      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <MetricCard icon={Sparkles} label="Requests" value={fmtInt(o?.requests)} sub={range} />
        <MetricCard icon={Activity} label="Tokens" value={fmtInt(o?.totalTokens)} sub="total" />
        <MetricCard icon={DollarSign} label="Cost" value={fmtUsd(o?.cost)} sub={range} />
        <MetricCard icon={BarChart3} label="Models" value={fmtInt(o?.models)} sub="distinct" />
        <MetricCard icon={Activity} label="Error rate" value={fmtPct(o?.errorRate)} sub="errors/requests" />
      </XStack>

      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <Card flex={1} minW={280} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" items="center">
          <Text fontSize="$3" fontWeight="800" color="$color12" self="flex-start">
            Requests by model
          </Text>
          {slices.length > 0 ? (
            <Donut slices={slices} legend />
          ) : (
            <Text fontSize="$2" color="$color10">
              No LLM usage in this range.
            </Text>
          )}
        </Card>
        <Card flex={2} minW={360} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$3" fontWeight="800" color="$color12">
            Usage by model
          </Text>
          <DataTable columns={cols} rows={models} rowKey={(r) => r.model} empty="No LLM usage yet." />
        </Card>
      </XStack>
    </YStack>
  )
}
