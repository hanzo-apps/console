'use client'

/**
 * Service Map (APM) — per-service RED metrics (Rate · Errors · Duration) plus the
 * service dependency graph, over the REAL Hanzo o11y (O11y) runtime.
 *
 * ONE honest source: the o11y APM controllers through the same-origin `/v1`
 * user-bearer proxy (`ApmApi`, lib/api/apm.ts) — the version-less canonical o11y
 * surface `/v1/o11y/services` (RED per service over the window),
 * `/v1/o11y/dependency_graph` (the call edges), and
 * `/v1/o11y/service/top_operations` (a service's hottest operations). Every KPI,
 * row, and edge is a fold over what the runtime returned — an empty result is an
 * honest empty state, never a fabricated service. When the runtime is not
 * initialized (503) / unrouted (404) / not enabled for the org (403) / the session
 * lapsed (401) it shows the shared `RuntimeNotice`, never placeholder APM data.
 *
 * Tap-to-act (the /machines pattern): click a service row → a detail rail with its
 * RED overview, top operations, and its upstream/downstream dependencies.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, AlertTriangle, Gauge, Network, RefreshCw, Timer } from '@hanzogui/lucide-icons-2'

import {
  ApmApi,
  apmWindow,
  type DependencyEdge,
  type ServiceRow,
  type TopOperation,
} from '~/lib/api'
import { PageHeader } from '@hanzo/ui/product'
import { MetricCard, Panel } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { SlideOver } from '@hanzo/ui/product'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { DetailRow } from './observability/parts'
import { fmtNs, fmtRate, fmtPct, fmtCount, errorTone } from './observability/apm-format'

/** Selectable lookback windows (label → seconds). */
const RANGES: { label: string; seconds: number }[] = [
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21_600 },
  { label: '24h', seconds: 86_400 },
]

type Data = { services: ServiceRow[]; edges: DependencyEdge[] }
type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; data: Data }

/** RED rollup across all services for the KPI band. */
function summarize(services: ServiceRow[]) {
  const totalCalls = services.reduce((s, r) => s + r.numCalls, 0)
  const totalErrors = services.reduce((s, r) => s + r.numErrors, 0)
  const rps = services.reduce((s, r) => s + r.callRate, 0)
  const slowestP99 = services.reduce((m, r) => Math.max(m, r.p99), 0)
  const errPct = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0
  return { count: services.length, rps, errPct, slowestP99, totalCalls }
}

export function ServiceMapModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [rangeIdx, setRangeIdx] = useState(2) // default 1h
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async (idx: number) => {
    setState({ phase: 'loading' })
    const w = apmWindow(RANGES[idx].seconds)
    try {
      // Services is the primary read; the dependency graph is best-effort (an
      // empty/unavailable graph must not blank the whole page), so it degrades to [].
      const services = await ApmApi.services(w)
      const edges = await ApmApi.dependencies(w).catch(() => [])
      setState({ phase: 'ready', data: { services, edges } })
    } catch (e) {
      setState({ phase: 'error', error: e })
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
        title="Service Map"
        subtitle="Per-service latency, errors, and throughput (RED) with the dependency graph."
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
          <Text color="$color11">Loading services…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <RuntimeNotice surface="services" error={state.error} />
      ) : (
        <Ready
          data={state.data}
          seconds={RANGES[rangeIdx].seconds}
          selected={selected}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

function Ready({
  data,
  seconds,
  selected,
  onSelect,
  onClose,
}: {
  data: Data
  seconds: number
  selected: string | null
  onSelect: (s: string) => void
  onClose: () => void
}) {
  const { services, edges } = data
  const summary = useMemo(() => summarize(services), [services])
  const selectedRow = useMemo(() => services.find((s) => s.serviceName === selected) ?? null, [services, selected])

  const columns: Column<ServiceRow>[] = [
    {
      key: 'serviceName',
      header: 'Service',
      render: (r) => (
        <Button chromeless px="$0" onPress={() => onSelect(r.serviceName)}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {r.serviceName}
          </Text>
        </Button>
      ),
    },
    { key: 'p99', header: 'P99', width: 100, render: (r) => <Text fontSize="$3" color="$color11">{fmtNs(r.p99)}</Text> },
    { key: 'avgDuration', header: 'Avg', width: 100, render: (r) => <Text fontSize="$3" color="$color11">{fmtNs(r.avgDuration)}</Text> },
    { key: 'callRate', header: 'Rate', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{fmtRate(r.callRate)}</Text> },
    {
      key: 'errorRate',
      header: 'Errors',
      width: 100,
      render: (r) => (
        <Text fontSize="$3" style={{ color: errorTone(r.errorRate) }}>
          {fmtPct(r.errorRate)}
        </Text>
      ),
    },
    { key: 'numCalls', header: 'Calls', width: 100, render: (r) => <Text fontSize="$3" color="$color11">{fmtCount(r.numCalls)}</Text> },
  ]

  return (
    <YStack gap="$4">
      {/* RED KPI band — folded from real service rows. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Network size={16} />} label="Services" value={String(summary.count)} caption={`last ${rangeLabel(seconds)}`} />
        <MetricCard icon={<Activity size={16} />} label="Throughput" value={fmtRate(summary.rps)} />
        <MetricCard
          icon={<AlertTriangle size={16} />}
          label="Error rate"
          value={summary.count > 0 ? fmtPct(summary.errPct) : '—'}
          caption={`${fmtCount(summary.totalCalls)} calls`}
        />
        <MetricCard icon={<Timer size={16} />} label="Slowest P99" value={fmtNs(summary.slowestP99)} />
      </XStack>

      <Panel title="Services" grow={false}>
        <DataTable
          columns={columns}
          rows={services}
          rowKey={(r) => r.serviceName}
          onRowPress={(r) => onSelect(r.serviceName)}
          empty="No services reporting in this window. Instrumented services appear here once they emit spans to the observability runtime."
        />
      </Panel>

      {selectedRow ? (
        <ServiceDetail row={selectedRow} edges={edges} seconds={seconds} onClose={onClose} onSelect={onSelect} />
      ) : null}
    </YStack>
  )
}

const rangeLabel = (seconds: number): string => RANGES.find((r) => r.seconds === seconds)?.label ?? `${seconds}s`

/** The tap-to-act detail rail: RED overview + top operations + dependency edges. */
function ServiceDetail({
  row,
  edges,
  seconds,
  onClose,
  onSelect,
}: {
  row: ServiceRow
  edges: DependencyEdge[]
  seconds: number
  onClose: () => void
  onSelect: (s: string) => void
}) {
  const [ops, setOps] = useState<TopOperation[] | null>(null)
  const [opsError, setOpsError] = useState<unknown>(null)

  useEffect(() => {
    let live = true
    setOps(null)
    setOpsError(null)
    ApmApi.topOperations(apmWindow(seconds), row.serviceName)
      .then((o) => {
        if (live) setOps(o)
      })
      .catch((e) => {
        if (live) setOpsError(e)
      })
    return () => {
      live = false
    }
  }, [row.serviceName, seconds])

  const upstream = edges.filter((e) => e.child === row.serviceName)
  const downstream = edges.filter((e) => e.parent === row.serviceName)

  return (
    <SlideOver open onClose={onClose} title={row.serviceName} icon={Network} size={480} ariaLabel={`${row.serviceName} detail`}>
      <YStack gap="$4" p="$4">
        <Card p="$3.5" gap="$1" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="700" mb="$1">
            RED · last {rangeLabel(seconds)}
          </Text>
          <DetailRow label="P99 latency" value={fmtNs(row.p99)} />
          <DetailRow label="Avg latency" value={fmtNs(row.avgDuration)} />
          <DetailRow label="Throughput" value={fmtRate(row.callRate)} />
          <DetailRow label="Calls" value={fmtCount(row.numCalls)} />
          <DetailRow label="Errors" value={`${fmtCount(row.numErrors)} · ${fmtPct(row.errorRate)}`} />
          <DetailRow label="4xx" value={`${fmtCount(row.num4XX)} · ${fmtPct(row.fourXXRate)}`} />
        </Card>

        <YStack gap="$2">
          <Text fontSize="$4" fontWeight="700">
            Top operations
          </Text>
          {opsError ? (
            <Text fontSize="$2" color="$color10">
              Operations aren&apos;t available for this service right now.
            </Text>
          ) : ops == null ? (
            <XStack gap="$2" items="center">
              <Spinner size="small" />
              <Text fontSize="$2" color="$color10">
                Loading operations…
              </Text>
            </XStack>
          ) : ops.length === 0 ? (
            <Text fontSize="$2" color="$color10">
              No operations recorded in this window.
            </Text>
          ) : (
            <YStack gap="$1.5">
              {ops.slice(0, 12).map((o) => (
                <XStack key={o.name} justify="space-between" gap="$2" items="center">
                  <Text fontSize="$2" color="$color12" numberOfLines={1} flex={1}>
                    {o.name}
                  </Text>
                  <Text fontSize="$1" color="$color10">
                    {fmtNs(o.p99)} · {fmtCount(o.numCalls)}
                  </Text>
                </XStack>
              ))}
            </YStack>
          )}
        </YStack>

        <DependencyList title="Upstream (callers)" edges={upstream} peer={(e) => e.parent} onSelect={onSelect} />
        <DependencyList title="Downstream (dependencies)" edges={downstream} peer={(e) => e.child} onSelect={onSelect} />
      </YStack>
    </SlideOver>
  )
}

function DependencyList({
  title,
  edges,
  peer,
  onSelect,
}: {
  title: string
  edges: DependencyEdge[]
  peer: (e: DependencyEdge) => string
  onSelect: (s: string) => void
}) {
  return (
    <YStack gap="$2">
      <Text fontSize="$4" fontWeight="700">
        {title}
      </Text>
      {edges.length === 0 ? (
        <Text fontSize="$2" color="$color10">
          None in this window.
        </Text>
      ) : (
        <YStack gap="$1.5">
          {edges.map((e) => {
            const name = peer(e)
            return (
              <XStack key={`${e.parent}->${e.child}`} justify="space-between" gap="$2" items="center">
                <Button chromeless px="$0" onPress={() => onSelect(name)}>
                  <XStack items="center" gap="$1.5">
                    <Gauge size={12} color="$color10" />
                    <Text fontSize="$2" color="$color12" numberOfLines={1}>
                      {name}
                    </Text>
                  </XStack>
                </Button>
                <Text fontSize="$1" style={{ color: errorTone(e.errorRate) }}>
                  {fmtRate(e.callRate)} · {fmtPct(e.errorRate)}
                </Text>
              </XStack>
            )
          })}
        </YStack>
      )}
    </YStack>
  )
}
