'use client'

/**
 * Fleet Observability — the admin.hanzo.ai GLOBAL o11y board (global-admin only).
 * The cross-org, un-org-scoped twin of the per-org console o11y: fleet totals +
 * timeseries + leaderboards, aggregated across EVERY tenant from the ONE
 * hanzoai/datastore, read through `AdminO11yApi.global` (the server-gated
 * `/v1/admin/o11y` aggregate — `getAdminGate` fail-closes a non-global-admin
 * request BEFORE any cross-tenant row is read).
 *
 * Gated twice: the registry entry is `admin: true` (hidden from every customer's
 * nav/palette) and this module renders `OperatorAccessRequired` for a
 * non-global-admin client. Honest by construction — every KPI is a real aggregate
 * or an em-dash, near-empty signals (o11y AI generations) render honest-empty,
 * and a failed fetch shows the honest error/access state, never a fabricated fleet.
 */
import { useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, AlertTriangle, Boxes, Building2, Coins, Cpu, Gauge, ScrollText, Waypoints } from '@hanzogui/lucide-icons-2'

import { AdminO11yApi, type FleetO11y, type O11yRange } from '~/lib/api/admin-o11y'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { LineChart, type ChartPoint } from '~/components/ui/Charts'
import { asApiError, ErrorState, OperatorAccessRequired } from '~/components/ui/States'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { formatMetric } from '~/components/products/overview/living/logic'

const RANGES: O11yRange[] = ['24h', '7d', '30d']
const pct1 = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')

/** Shorten a warehouse `ts` ("2026-07-04 06:00:00") for a chart x-label. */
const tsLabel = (ts: string, range: O11yRange): string => {
  const t = Date.parse(ts.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(t)) return ts
  const d = new Date(t)
  return range === '24h'
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}/${d.getDate()}`
}

type State = { loading: boolean; error: unknown; data: FleetO11y | null }

const ORG_COLS: Column<FleetO11y['topOrgs'][number]>[] = [
  { key: 'org', header: 'Organization', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.org || '—'}</Text> },
  { key: 'requests', header: 'Requests', width: 96, align: 'right', mono: true, render: (r) => formatMetric(r.requests, 'count') },
  { key: 'tokens', header: 'Tokens', width: 96, align: 'right', mono: true, render: (r) => formatMetric(r.tokens, 'count') },
  { key: 'costCents', header: 'Cost', width: 90, align: 'right', mono: true, render: (r) => formatMetric(r.costCents, 'cents') },
]

const MODEL_COLS: Column<FleetO11y['topModels'][number]>[] = [
  { key: 'model', header: 'Model', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.model || '—'}</Text> },
  { key: 'requests', header: 'Requests', width: 96, align: 'right', mono: true, render: (r) => formatMetric(r.requests, 'count') },
  { key: 'tokens', header: 'Tokens', width: 96, align: 'right', mono: true, render: (r) => formatMetric(r.tokens, 'count') },
  { key: 'costCents', header: 'Cost', width: 90, align: 'right', mono: true, render: (r) => formatMetric(r.costCents, 'cents') },
]

const SVC_COLS: Column<FleetO11y['topServices'][number]>[] = [
  { key: 'service', header: 'Service', render: (r) => <Text fontSize="$2" numberOfLines={1}>{r.service || '—'}</Text> },
  { key: 'requests', header: 'Spans', width: 96, align: 'right', mono: true, render: (r) => formatMetric(r.requests, 'count') },
  { key: 'errorRate', header: 'Errors', width: 84, align: 'right', mono: true, render: (r) => pct1(r.errorRate) },
  { key: 'latencyP95Ms', header: 'p95', width: 84, align: 'right', mono: true, render: (r) => formatMetric(r.latencyP95Ms, 'ms') },
]

export function AdminO11yModule() {
  const isAdmin = useIsSuperAdmin()
  const [range, setRange] = useState<O11yRange>('7d')
  const [st, setSt] = useState<State>({ loading: true, error: null, data: null })

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    setSt((s) => ({ ...s, loading: true, error: null }))
    AdminO11yApi.global(range)
      .then((data) => alive && setSt({ loading: false, error: null, data }))
      .catch((error) => alive && setSt({ loading: false, error, data: null }))
    return () => {
      alive = false
    }
  }, [isAdmin, range])

  // Client gate — a non-global-admin never sees the cross-tenant board (the server
  // gate is the authoritative one; this is the honest UI twin).
  if (!isAdmin) return <OperatorAccessRequired />

  const d = st.data
  const t = d?.totals
  const reqSeries: ChartPoint[] = (d?.series ?? []).map((p) => ({ label: tsLabel(p.ts, range), value: p.requests }))
  const costSeries: ChartPoint[] = (d?.series ?? []).map((p) => ({ label: tsLabel(p.ts, range), value: p.costCents }))
  const logSeries: ChartPoint[] = (d?.logSeries ?? []).map((p) => ({ label: tsLabel(p.ts, range), value: p.count }))

  return (
    <YStack gap="$4" p="$4" maxW={1200} self="center" width="100%">
      <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
        <YStack gap="$1">
          <XStack items="center" gap="$2">
            <Activity size={20} />
            <Text fontSize="$7" fontWeight="800">
              Fleet Observability
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            Cross-org requests, tokens, cost, latency, errors, logs and traces across the whole platform — the fleet
            operator view. All tenants aggregated; a customer never sees this.
          </Text>
        </YStack>
        <XStack gap="$1">
          {RANGES.map((r) => (
            <Button key={r} size="$2" chromeless={range !== r} bg={range === r ? '$color5' : 'transparent'} onPress={() => setRange(r)}>
              {r}
            </Button>
          ))}
        </XStack>
      </XStack>

      {st.error ? (
        <ErrorState err={asApiError(st.error)} onRetry={() => setRange((r) => r)} />
      ) : (
        <>
          {/* Fleet KPI band. */}
          <XStack gap="$3" flexWrap="wrap">
            <Kpi icon={<Activity size={15} />} label="Requests" value={t ? formatMetric(t.requests, 'count') : '—'} caption="LLM calls, all orgs" spark={reqSeries.map((p) => p.value)} />
            <Kpi icon={<Boxes size={15} />} label="Tokens" value={t ? formatMetric(t.tokens, 'count') : '—'} caption={t ? `${formatMetric(t.promptTokens, 'count')} in · ${formatMetric(t.completionTokens, 'count')} out` : ''} />
            <Kpi icon={<Coins size={15} />} label="Cost" value={t ? formatMetric(t.costCents, 'cents') : '—'} caption="all orgs" spark={costSeries.map((p) => p.value)} />
            <Kpi icon={<AlertTriangle size={15} />} label="Errors" value={t ? formatMetric(t.errors, 'count') : '—'} caption={t ? `trace err ${pct1(t.traceErrorRate)}` : ''} />
            <Kpi icon={<Gauge size={15} />} label="Latency p95 / p99" value={t ? `${formatMetric(t.latencyP95Ms, 'ms')} / ${formatMetric(t.latencyP99Ms, 'ms')}` : '—'} caption={t ? `p50 ${formatMetric(t.latencyP50Ms, 'ms')}` : ''} />
            <Kpi icon={<ScrollText size={15} />} label="Log volume" value={t ? formatMetric(t.logVolume, 'count') : '—'} caption="lines this window" spark={logSeries.map((p) => p.value)} />
            <Kpi icon={<Building2 size={15} />} label="Active orgs" value={t ? formatMetric(t.orgs, 'count') : '—'} caption={t ? `${formatMetric(t.models, 'count')} models` : ''} />
            <Kpi icon={<Waypoints size={15} />} label="Services · traces" value={t ? `${formatMetric(t.services, 'count')} · ${formatMetric(t.traceCount, 'count')}` : '—'} caption="emitting spans" />
          </XStack>

          {/* Timeseries. */}
          <XStack gap="$4" flexWrap="wrap">
            <Card flex={1} minW={320} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <Text fontSize="$4" fontWeight="700">
                Requests over time
              </Text>
              {reqSeries.length >= 2 ? <LineChart data={reqSeries} formatValue={(v) => formatMetric(v, 'count')} /> : <Empty note="No usage in this window." />}
            </Card>
            <Card flex={1} minW={320} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <Text fontSize="$4" fontWeight="700">
                Log volume over time
              </Text>
              {logSeries.length >= 2 ? <LineChart data={logSeries} formatValue={(v) => formatMetric(v, 'count')} /> : <Empty note="No logs in this window." />}
            </Card>
          </XStack>

          {/* Leaderboards. */}
          <XStack gap="$4" flexWrap="wrap">
            <Card flex={1} minW={320} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
              <XStack items="center" gap="$2">
                <Building2 size={15} />
                <Text fontSize="$4" fontWeight="700">
                  Top organizations
                </Text>
              </XStack>
              <DataTable columns={ORG_COLS} rows={d?.topOrgs ?? []} loading={st.loading} rowKey={(r) => r.org} empty="No org usage in this window." />
            </Card>
            <Card flex={1} minW={320} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
              <XStack items="center" gap="$2">
                <Cpu size={15} />
                <Text fontSize="$4" fontWeight="700">
                  Top models
                </Text>
              </XStack>
              <DataTable columns={MODEL_COLS} rows={d?.topModels ?? []} loading={st.loading} rowKey={(r) => r.model} empty="No model usage in this window." />
            </Card>
          </XStack>

          <XStack gap="$4" flexWrap="wrap">
            <Card flex={1} minW={320} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
              <XStack items="center" gap="$2">
                <Waypoints size={15} />
                <Text fontSize="$4" fontWeight="700">
                  Top services by traffic
                </Text>
              </XStack>
              <DataTable columns={SVC_COLS} rows={d?.topServices ?? []} loading={st.loading} rowKey={(r) => r.service} empty="No spans in this window." />
            </Card>
            <Card flex={1} minW={320} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
              <XStack items="center" gap="$2">
                <Boxes size={15} />
                <Text fontSize="$4" fontWeight="700">
                  LLM generations
                </Text>
              </XStack>
              <XStack gap="$3" flexWrap="wrap">
                <Kpi icon={<Boxes size={15} />} label="Generations" value={d ? formatMetric(d.llm.generations, 'count') : '—'} caption="fleet-wide" />
                <Kpi icon={<Coins size={15} />} label="Generation cost" value={d ? `$${d.llm.costUsd.toFixed(4)}` : '—'} caption="fleet-wide" />
              </XStack>
              <Text fontSize="$2" color="$color10">
                Detailed generation traces populate here as generation ingestion grows — no figures are fabricated.
              </Text>
            </Card>
          </XStack>
        </>
      )}
    </YStack>
  )
}

/** A flexing KPI tile (wraps to stack on narrow viewports). */
function Kpi({ icon, label, value, caption, spark }: { icon: React.ReactElement; label: string; value: string; caption?: string; spark?: number[] }) {
  return (
    <YStack flex={1} minW={168}>
      <MetricCard icon={icon} label={label} value={value} caption={caption} spark={spark} />
    </YStack>
  )
}

/** Honest chart-empty note (never a fabricated trend). */
function Empty({ note }: { note: string }) {
  return (
    <XStack height={210} items="center" justify="center">
      <Text fontSize="$3" color="$color10">
        {note}
      </Text>
    </XStack>
  )
}
