'use client'

/**
 * Metrics — live platform infrastructure metrics, from REAL VictoriaMetrics data.
 *
 * ONE honest source: VictoriaMetrics (Prometheus-compatible) through the same-origin
 * read-only `/telemetry` proxy. This is the INFRASTRUCTURE metrics dashboard — the
 * health of every Hanzo platform service (`up{}`), a healthy-services trend
 * (`sum(up)` over the window), and the current up/down breakdown. It is distinct
 * from AI Metrics (per-org LLM usage from the commerce ledger, a separate surface).
 *
 * Every KPI, series, and bar is a pure fold over what VictoriaMetrics returned
 * (`lib/api/telemetry.ts`) — an empty result rolls up to honest zeros / empty
 * charts, never fabricated data. When the telemetry store is not configured (501)
 * or unreachable (401/5xx) it shows an honest state, never placeholder metrics.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, CheckCircle2, Gauge, RefreshCw, Server, TriangleAlert, XCircle } from '@hanzogui/lucide-icons-2'

import {
  ApiError,
  TelemetryApi,
  summarizeHealth,
  toServiceHealth,
  windowOf,
  type Series,
  type ServiceHealth,
} from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard, Panel } from '~/components/ui/Metric'
import { LineChart, type ChartPoint } from '~/components/ui/Charts'
import { Donut, type DonutSegment } from '~/components/ui/Donut'

/** Selectable lookback windows (label → seconds). */
const RANGES: { label: string; seconds: number }[] = [
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21_600 },
  { label: '24h', seconds: 86_400 },
  { label: '7d', seconds: 604_800 },
]

type Data = { health: ServiceHealth[]; healthy: ChartPoint[]; targets: ChartPoint[] }
type State = { phase: 'loading' } | { phase: 'error'; status: number; message: string } | { phase: 'ready'; data: Data }

/** First aggregation series → chart points labelled by local time. */
function toPoints(series: Series[], seconds: number): ChartPoint[] {
  const s = series[0]
  if (!s) return []
  const dayScale = seconds > 86_400
  return s.points.map((p) => {
    const d = new Date(p.t * 1000)
    const label = dayScale
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    return { label, value: p.v }
  })
}

export function MetricsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [rangeIdx, setRangeIdx] = useState(2) // default 24h

  const load = useCallback(async (idx: number) => {
    setState({ phase: 'loading' })
    const w = windowOf(RANGES[idx].seconds)
    try {
      const [up, healthy, targets] = await Promise.all([
        TelemetryApi.instant('up'),
        TelemetryApi.range('sum(up)', w),
        TelemetryApi.range('count(up)', w),
      ])
      setState({
        phase: 'ready',
        data: {
          health: toServiceHealth(up),
          healthy: toPoints(healthy, RANGES[idx].seconds),
          targets: toPoints(targets, RANGES[idx].seconds),
        },
      })
    } catch (e) {
      setState({
        phase: 'error',
        status: e instanceof ApiError ? e.status : 0,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }, [])

  useEffect(() => {
    void load(rangeIdx)
  }, [load, rangeIdx])

  const rangeSelector = (
    <XStack gap="$1" flexWrap="wrap">
      {RANGES.map((r, i) => (
        <Button
          key={r.label}
          size="$2"
          bg={i === rangeIdx ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={() => setRangeIdx(i)}
        >
          {r.label}
        </Button>
      ))}
    </XStack>
  )

  return (
    <>
      <PageHeader
        title="Metrics"
        subtitle="Live platform service health and infrastructure metrics."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            {rangeSelector}
            <Button icon={<RefreshCw size={16} />} onPress={() => void load(rangeIdx)}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading metrics…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <MetricsError status={state.status} message={state.message} onRetry={() => void load(rangeIdx)} />
      ) : (
        <Ready data={state.data} />
      )}
    </>
  )
}

function Ready({ data }: { data: Data }) {
  const summary = summarizeHealth(data.health)
  const uptimePct = summary.total > 0 ? Math.round((summary.healthy / summary.total) * 100) : 0
  const down = data.health.filter((r) => !r.up)
  const segments: DonutSegment[] = [
    { label: 'Healthy', value: summary.healthy, color: '#30a46c' },
    { label: 'Down', value: summary.down, color: '#e5484d' },
  ]

  return (
    <YStack gap="$4">
      {/* KPI tiles — all folded from real `up` samples. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Server size={16} />} label="Services" value={String(summary.total)} />
        <MetricCard
          icon={<CheckCircle2 size={16} />}
          label="Healthy"
          value={String(summary.healthy)}
          spark={data.healthy.map((p) => p.value)}
          sparkColor="#30a46c"
        />
        <MetricCard icon={<XCircle size={16} />} label="Down" value={String(summary.down)} />
        <MetricCard icon={<Gauge size={16} />} label="Uptime" value={`${uptimePct}%`} caption="services up now" />
      </XStack>

      {/* Real time series (zero-filled by VictoriaMetrics' step). */}
      <XStack gap="$4" flexWrap="wrap">
        <Panel title="Healthy services over time">
          <LineChart data={data.healthy} color="#30a46c" formatValue={(v) => String(Math.round(v))} />
        </Panel>
        <Panel title="Scrape targets over time">
          <LineChart data={data.targets} formatValue={(v) => String(Math.round(v))} />
        </Panel>
      </XStack>

      {/* Current breakdown + anything needing attention. */}
      <XStack gap="$4" flexWrap="wrap">
        <Panel title="Service health" minW={300}>
          <XStack gap="$4" items="center" flexWrap="wrap">
            <Donut segments={segments} size={148} centerValue={`${uptimePct}%`} centerLabel="up" />
            <YStack gap="$2">
              {segments.map((s) => (
                <XStack key={s.label} items="center" gap="$2">
                  <YStack width={10} height={10} rounded="$10" style={{ backgroundColor: s.color }} />
                  <Text fontSize="$2" color="$color11">
                    {s.label}
                  </Text>
                  <Text fontSize="$2" fontWeight="700" color="$color12">
                    {s.value}
                  </Text>
                </XStack>
              ))}
            </YStack>
          </XStack>
        </Panel>

        <Panel title={down.length > 0 ? `Down now (${down.length})` : 'All services healthy'} minW={300}>
          {down.length > 0 ? (
            <YStack gap="$1.5">
              {down.map((r) => (
                <XStack key={`${r.job}:${r.instance}`} items="center" gap="$2" justify="space-between">
                  <XStack items="center" gap="$2" minW={0} flex={1}>
                    <XCircle size={14} color="$red10" />
                    <Text fontSize="$3" color="$color12" numberOfLines={1}>
                      {r.service}
                    </Text>
                  </XStack>
                  <Text fontSize="$1" color="$color10" numberOfLines={1}>
                    {r.instance}
                  </Text>
                </XStack>
              ))}
            </YStack>
          ) : (
            <XStack items="center" gap="$2">
              <CheckCircle2 size={16} color="$green10" />
              <Text fontSize="$3" color="$color11">
                Every scraped service is reporting healthy.
              </Text>
            </XStack>
          )}
        </Panel>
      </XStack>
    </YStack>
  )
}

/** Honest failure card — 501 not-configured, 401 access, else a real error. */
function MetricsError({ status, message, onRetry }: { status: number; message: string; onRetry: () => void }) {
  const title =
    status === 501
      ? 'Telemetry not configured'
      : status === 401
        ? 'Sign in to view metrics'
        : 'Could not reach the telemetry store'
  const body =
    status === 501
      ? 'This console reads metrics from VictoriaMetrics, but the telemetry store URL (VM_URL) is not set on this deployment yet. Once it is, live infrastructure metrics appear here — no fabricated data is shown.'
      : status === 401
        ? 'Platform metrics are available to signed-in users. Please sign in.'
        : message
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {body}
      </Text>
      {status !== 401 ? (
        <Button size="$2" self="flex-start" icon={<Activity size={15} />} onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
