/**
 * Native Analytics — the per-org analytics module over the unified ClickHouse
 * warehouse (datastore), read through cloud-api `/v1/analytics/*` via the same-origin
 * `/v1` bearer proxy, so every metric is scoped to the caller's own IAM org
 * (server-authoritative, from the Bearer owner) — the browser holds no datastore
 * credential.
 *
 * Bound to exactly the FOUR routes the backend mounts (overview/timeseries/top/health):
 *   - Overview — the LLM lens (requests/tokens/spend/models/providers/errors) is REAL
 *     live per-org data (hanzo.cloud_usage), charted over time; the Web + Commerce
 *     lenses (hanzo.events) render HONEST-empty ("no events yet") until a collector
 *     emits — never fabricated numbers.
 *   - LLM — the real per-model table + spend donut (top models).
 *
 * There is deliberately NO "Real-Time" tab: the backend exposes no realtime feed, so
 * inventing one would be a fabrication. Every number here is a real query result;
 * empty is honest-empty ("—" / "no data yet"); a 403 (cookie-only) or 503 (warehouse
 * unwired) surfaces the shared BackendStateCard.
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, BarChart3, DollarSign, Sparkles, Server, TriangleAlert, Zap } from '@hanzogui/lucide-icons-2'

import {
  AnalyticsApi,
  RANGES,
  type ModelRow,
  type Overview,
  type Range,
  type SeriesPoint,
  type Top,
} from '~/lib/api/analytics'
import { fmtUsd, fmtInt } from '~/lib/api/functions'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { LineChart, Donut, CHART_PALETTE, type ChartPoint, type Slice } from '@hanzo/ui/product'
import { classifyBackend, BackendStateCard, type BackendState } from '@hanzo/ui/product'
import { MetricCard } from './functions/parts'

const fmtPct = (n: number): string => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—')

const TABS = [
  { id: '', label: 'Overview', icon: BarChart3 },
  { id: 'llm', label: 'LLM', icon: Sparkles },
] as const

export function AnalyticsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = useMemo(() => {
    const t = params.tab ?? ''
    return TABS.some((x) => x.id === t) ? t : ''
  }, [params.tab])

  return (
    <YStack gap="$5">
      <PageHeader
        title="Analytics"
        subtitle="Per-org LLM, web, and commerce analytics over the unified warehouse."
        actions={
          <XStack gap="$1" flexWrap="wrap">
            {TABS.map((t) => (
              <TabButton key={t.id || 'overview'} active={t.id === tab} label={t.label} Icon={t.icon}
                onPress={() => router.push(t.id ? `/analytics/${t.id}` : '/analytics')} />
            ))}
          </XStack>
        }
      />
      {tab === 'llm' ? <LlmTab /> : <OverviewTab />}
    </YStack>
  )
}

function TabButton({ active, label, Icon, onPress }: { active: boolean; label: string; Icon: typeof BarChart3; onPress: () => void }) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      items="center"
      gap="$1.5"
      px="$3"
      height={34}
      rounded="$3"
      borderWidth={1}
      borderColor="$borderColor"
      bg={active ? '$color5' : 'transparent'}
      hoverStyle={{ bg: '$color3' }}
    >
      <Icon size={15} />
      <Text fontSize="$3" fontWeight="600" color="$color12">{label}</Text>
    </XStack>
  )
}

function RangeBar({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  return (
    <XStack gap="$1">
      {RANGES.map((r) => (
        <XStack
          key={r}
          onPress={() => onChange(r)}
          cursor="pointer"
          px="$2.5"
          height={30}
          items="center"
          rounded="$3"
          borderWidth={1}
          borderColor="$borderColor"
          bg={r === range ? '$color6' : 'transparent'}
          hoverStyle={{ bg: '$color3' }}
        >
          <Text fontSize="$2" fontWeight="600" color="$color12">{r}</Text>
        </XStack>
      ))}
    </XStack>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────
type OverviewState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; overview: Overview; series: SeriesPoint[] }

function OverviewTab() {
  const [range, setRange] = useState<Range>('7d')
  const [state, setState] = useState<OverviewState>({ phase: 'loading' })

  const load = useCallback(async (r: Range) => {
    setState({ phase: 'loading' })
    try {
      const [overview, series] = await Promise.all([AnalyticsApi.overview(r), AnalyticsApi.timeseries(r)])
      setState({ phase: 'ready', overview, series })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])
  useEffect(() => { void load(range) }, [load, range])

  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        <XStack justify="flex-end"><RangeBar range={range} onChange={setRange} /></XStack>
        <BackendStateCard state={state.error} onRetry={() => void load(range)} hint="endpoint · GET /v1/analytics/overview" />
      </YStack>
    )
  }

  const o = state.phase === 'ready' ? state.overview : null
  const series = state.phase === 'ready' ? state.series : []
  const chartData: ChartPoint[] = series.map((p) => ({ label: p.t, value: p.spendCents }))

  return (
    <YStack gap="$4">
      <XStack justify="flex-end"><RangeBar range={range} onChange={setRange} /></XStack>

      {/* LLM lens — REAL per-org data. */}
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <MetricCard icon={Sparkles} label="LLM requests" value={fmtInt(o?.llm.requests)} sub={range} />
        <MetricCard icon={Activity} label="Tokens" value={fmtInt(o?.llm.tokens)} sub="total" />
        <MetricCard icon={DollarSign} label="LLM spend" value={fmtUsd(o?.llm.spendCents)} sub={range} />
        <MetricCard icon={BarChart3} label="Models" value={fmtInt(o?.llm.models)} sub="distinct" />
        <MetricCard icon={Server} label="Providers" value={fmtInt(o?.llm.providers)} sub="distinct" />
        <MetricCard icon={TriangleAlert} label="Error rate" value={o ? fmtPct(o.llm.errorRate) : '—'} sub="errors/requests" />
      </XStack>

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$4" fontWeight="800" color="$color12">LLM spend over time</Text>
        {chartData.some((p) => p.value > 0) ? (
          <LineChart data={chartData} formatValue={(v) => fmtUsd(v)} />
        ) : (
          <Text fontSize="$2" color="$color10">No LLM usage in this range yet.</Text>
        )}
      </Card>

      {/* Web + Commerce lenses — honest-empty until the events collector emits. */}
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <LensCard
          title="Web"
          available={Boolean(o?.web.available)}
          reason={o?.web.reason || 'No web analytics events yet'}
          metrics={[
            { label: 'Pageviews', value: fmtInt(o?.web.pageviews) },
            { label: 'Visitors', value: fmtInt(o?.web.visitors) },
            { label: 'Sessions', value: fmtInt(o?.web.sessions) },
          ]}
        />
        <LensCard
          title="Commerce"
          available={Boolean(o?.commerce.available)}
          reason={o?.commerce.reason || 'No commerce events yet'}
          metrics={[
            { label: 'Orders', value: fmtInt(o?.commerce.orders) },
            { label: 'Revenue', value: o ? `$${o.commerce.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' },
            { label: 'AOV', value: o ? `$${o.commerce.aov.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' },
          ]}
        />
      </XStack>
    </YStack>
  )
}

function LensCard({ title, available, reason, metrics }: { title: string; available: boolean; reason: string; metrics: { label: string; value: string }[] }) {
  return (
    <Card flex={1} minW={320} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        <Text fontSize="$4" fontWeight="800" color="$color12">{title}</Text>
        {!available ? <Text fontSize="$1" color="$color10">· honest-empty</Text> : null}
      </XStack>
      {available ? (
        <XStack flexWrap="wrap" gap="$4">
          {metrics.map((m) => (
            <YStack key={m.label} minW={90}>
              <Text fontSize="$2" color="$color10">{m.label}</Text>
              <Text fontSize="$6" fontWeight="800" color="$color12">{m.value}</Text>
            </YStack>
          ))}
        </XStack>
      ) : (
        <Text fontSize="$2" color="$color10">
          {reason}. Install the tracking snippet or connect commerce to start collecting {title.toLowerCase()} events for
          this organization — this shows real data only, nothing is fabricated.
        </Text>
      )}
    </Card>
  )
}

// ── LLM (top models) ───────────────────────────────────────────────────────────
type LlmState = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; top: Top }

function LlmTab() {
  const [range, setRange] = useState<Range>('7d')
  const [state, setState] = useState<LlmState>({ phase: 'loading' })

  const load = useCallback(async (r: Range) => {
    setState({ phase: 'loading' })
    try {
      setState({ phase: 'ready', top: await AnalyticsApi.top(r, 20) })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])
  useEffect(() => { void load(range) }, [load, range])

  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        <XStack justify="flex-end"><RangeBar range={range} onChange={setRange} /></XStack>
        <BackendStateCard state={state.error} onRetry={() => void load(range)} hint="endpoint · GET /v1/analytics/top" />
      </YStack>
    )
  }

  const models = state.phase === 'ready' ? state.top.models.items : []
  const slices: Slice[] = models.slice(0, 6).map((m, i) => ({
    label: m.model,
    value: m.spendCents,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }))

  const cols: Column<ModelRow>[] = [
    { key: 'model', header: 'Model', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12">{r.model || '—'}</Text> },
    { key: 'provider', header: 'Provider', width: 130, render: (r) => <Text fontSize="$3" color="$color11">{r.provider || '—'}</Text> },
    { key: 'requests', header: 'Requests', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{fmtInt(r.requests)}</Text> },
    { key: 'tokens', header: 'Tokens', width: 120, render: (r) => <Text fontSize="$3" color="$color11">{fmtInt(r.tokens)}</Text> },
    { key: 'spend', header: 'Spend', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{fmtUsd(r.spendCents)}</Text> },
    { key: 'pct', header: 'Share', width: 90, render: (r) => <Text fontSize="$3" color="$color11">{Number.isFinite(r.pct) ? `${r.pct.toFixed(1)}%` : '—'}</Text> },
  ]

  return (
    <YStack gap="$4">
      <XStack justify="flex-end"><RangeBar range={range} onChange={setRange} /></XStack>
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <Card flex={1} minW={280} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" items="center">
          <XStack items="center" gap="$2" self="flex-start">
            <Zap size={16} />
            <Text fontSize="$3" fontWeight="800" color="$color12">Spend by model</Text>
          </XStack>
          {slices.some((s) => s.value > 0) ? (
            <Donut slices={slices} legend />
          ) : (
            <Text fontSize="$2" color="$color10">No LLM usage in this range.</Text>
          )}
        </Card>
        <Card flex={2} minW={360} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$3" fontWeight="800" color="$color12">Usage by model</Text>
          <DataTable
            columns={cols}
            rows={models}
            loading={state.phase === 'loading'}
            rowKey={(r) => r.model || '—'}
            empty="No LLM usage yet. Model usage for this organization appears here as calls are made."
          />
        </Card>
      </XStack>
    </YStack>
  )
}
