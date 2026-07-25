'use client'

/**
 * Functions → Overview. The product's at-a-glance board: six KPI cards (derived
 * from the REAL inventory rows), an "Invocations over time" chart with range
 * toggles, an "Invocation status" donut, and the functions table + detail rail.
 *
 * Honest by construction. The KPIs are `deriveOverview` over the inventory — never
 * fabricated; a metric no row carries reads "—". The KPI sparklines + the chart +
 * the donut read the time-series facade (`FunctionsApi.metrics(range)`); until that
 * route is bound it 404s and those panels show a truthful "time-series not
 * connected" note instead of a placeholder trend. The 7-day deltas are real
 * second-half-vs-first-half changes of the returned series (`trendPct`), shown only
 * when there's enough data to compute one.
 *
 * Style props use the v5 shorthand set (bg/p/px/py/gap/rounded/items/self/...).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  AlertTriangle,
  Boxes,
  Clock,
  DollarSign,
  FunctionSquare,
  Percent,
  Zap,
} from '@hanzogui/lucide-icons-2'

import {
  FunctionsApi,
  deriveOverview,
  summedSeries,
  trendPct,
  fmtCompact,
  fmtPct,
  fmtDuration,
  fmtInt,
  fmtUsd,
  METRICS_RANGES,
  type FunctionsMetrics,
  type MetricsRange,
  type ServerlessFunction,
} from '~/lib/api/functions'
import { LineChart, Sparkline, Donut, type ChartPoint, type Slice } from '~/components/ui/Charts'
import { RAMP } from '~/lib/theme/ramp'
import { classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { MetricCard, Delta } from './parts'
import { FunctionsBrowser } from './FunctionsBrowser'

type MetricsState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: FunctionsMetrics }

/** Format a chart bucket label from an ISO/loose timestamp (compact, locale time). */
function bucketLabel(t: string): string {
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return t
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
}

export function OverviewTab({
  functions,
  loading,
  live,
  docsHref,
  onAfterDelete,
}: {
  functions: ServerlessFunction[]
  loading: boolean
  live: boolean
  docsHref: string
  onAfterDelete: (name: string) => void
}) {
  const [range, setRange] = useState<MetricsRange>('7D')
  const [metrics, setMetrics] = useState<MetricsState>({ phase: 'loading' })

  const loadMetrics = useCallback(async (r: MetricsRange) => {
    setMetrics({ phase: 'loading' })
    try {
      const data = await FunctionsApi.metrics(r)
      setMetrics({ phase: 'ready', data })
    } catch (e) {
      setMetrics({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void loadMetrics(range)
  }, [loadMetrics, range])

  const stats = useMemo(() => deriveOverview(functions), [functions])

  // The invocations chart + its per-card sparkline come from the real series.
  const series = metrics.phase === 'ready' ? metrics.data.series : []
  const totals = useMemo(() => summedSeries(series), [series])
  const chartData: ChartPoint[] = useMemo(() => {
    if (!series.length) return []
    // Bucket labels from the first (longest) line; values are the summed totals.
    const labels = series.reduce((a, b) => (b.points.length > a.points.length ? b : a), series[0]).points
    return totals.map((v, i) => ({ label: bucketLabel(labels[i]?.t ?? ''), value: v }))
  }, [series, totals])

  const invDelta = trendPct(totals)
  const statusBreakdown = metrics.phase === 'ready' ? metrics.data.status : null
  const costCents = metrics.phase === 'ready' ? metrics.data.costCents : null

  const statusSlices: Slice[] = statusBreakdown
    ? [
        { label: 'Success', value: statusBreakdown.success, color: RAMP[1] },
        { label: 'Timeout', value: statusBreakdown.timeout, color: RAMP[2] },
        { label: 'Error', value: statusBreakdown.error, color: RAMP[4] },
      ]
    : []
  const statusTotal = statusBreakdown ? statusBreakdown.success + statusBreakdown.timeout + statusBreakdown.error : 0

  const spark = totals.length >= 2 ? <Sparkline values={totals} /> : undefined

  return (
    <YStack gap="$4">
      {/* KPI cards — derived from real rows; sparkline/delta from the real series */}
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <MetricCard icon={FunctionSquare} label="Functions" value={fmtInt(stats.count)} sub="deployed" />
        <MetricCard
          icon={Zap}
          label="Invocations 7D"
          value={fmtCompact(stats.invocations7d)}
          sub="last 7 days"
          spark={spark}
          delta={<Delta pct={invDelta} />}
        />
        <MetricCard icon={Percent} label="Success rate" value={fmtPct(stats.successRate)} sub="weighted" />
        <MetricCard icon={Clock} label="Avg duration" value={fmtDuration(stats.avgDurationMs)} sub="per invocation" />
        <MetricCard icon={AlertTriangle} label="Errors" value={fmtCompact(stats.errors7d)} sub="last 7 days" />
        <MetricCard icon={DollarSign} label="Cost" value={fmtUsd(costCents)} sub={range} />
      </XStack>

      {/* Invocations over time + status donut */}
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <Card flex={2} minW={360} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
            <Text fontSize="$4" fontWeight="800" color="$color12">
              Invocations over time
            </Text>
            <XStack gap="$1">
              {METRICS_RANGES.map((r) => (
                <Button
                  key={r}
                  size="$1"
                  bg={r === range ? '$color5' : 'transparent'}
                  borderWidth={1}
                  borderColor="$borderColor"
                  onPress={() => setRange(r)}
                >
                  {r}
                </Button>
              ))}
            </XStack>
          </XStack>
          {metrics.phase === 'loading' ? (
            <YStack height={210} items="center" justify="center">
              <Text fontSize="$2" color="$color10">
                Loading invocations…
              </Text>
            </YStack>
          ) : chartData.length >= 2 ? (
            <LineChart data={chartData} formatValue={(v) => fmtCompact(v)} />
          ) : (
            <YStack height={210} items="center" justify="center" gap="$1">
              <Text fontSize="$3" color="$color11" fontWeight="600">
                No invocation time-series yet
              </Text>
              <Text fontSize="$2" color="$color10" text="center" maxW={420}>
                The Functions metrics route isn&apos;t connected on this deployment, so no trend is
                shown here. Headline counts above are read from the live inventory.
              </Text>
            </YStack>
          )}
        </Card>

        <Card flex={1} minW={240} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="800" color="$color12">
            Invocation status
          </Text>
          {statusTotal > 0 ? (
            <YStack items="center" gap="$3">
              <Donut
                slices={statusSlices}
                center={
                  <YStack items="center">
                    <Text fontSize="$6" fontWeight="900" color="$color12">
                      {fmtPct(statusBreakdown ? statusBreakdown.success / statusTotal : null)}
                    </Text>
                    <Text fontSize="$1" color="$color10">
                      success
                    </Text>
                  </YStack>
                }
              />
              <YStack gap="$1.5" self="stretch">
                {statusSlices.map((s) => (
                  <XStack key={s.label} items="center" gap="$2">
                    <YStack width={9} height={9} rounded="$2" style={{ backgroundColor: s.color }} />
                    <Text fontSize="$2" color="$color11" flex={1}>
                      {s.label}
                    </Text>
                    <Text fontSize="$2" color="$color12" fontWeight="600">
                      {fmtCompact(s.value)}
                    </Text>
                  </XStack>
                ))}
              </YStack>
            </YStack>
          ) : (
            <YStack height={180} items="center" justify="center" gap="$1">
              <Boxes size={22} color="$color9" />
              <Text fontSize="$2" color="$color10" text="center" maxW={220}>
                Status breakdown appears once the metrics route reports invocation outcomes.
              </Text>
            </YStack>
          )}
        </Card>
      </XStack>

      {/* Functions table + detail rail */}
      <YStack gap="$3">
        <Text fontSize="$4" fontWeight="800" color="$color12">
          Functions
        </Text>
        <FunctionsBrowser
          functions={functions}
          loading={loading}
          live={live}
          docsHref={docsHref}
          onAfterDelete={onAfterDelete}
        />
      </YStack>
    </YStack>
  )
}
