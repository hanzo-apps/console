'use client'

/**
 * Subsystems — the per-subsystem lens on the one cloud binary. GLOBAL-ADMIN only.
 *
 * The binary is a single process mounting ~60 subsystems, so a fleet-wide o11y board
 * cannot answer "which subsystem is slow / erroring / dark". This one can: cloud stamps
 * `hanzo.subsystem` on the request span it already emits, so the RED signals come out
 * of the same trace warehouse with no second metrics path.
 *
 * The board keeps two kinds of truth apart, because they fail differently. The
 * INVENTORY (name / prefixes / enabled) is the process's own mount index — always
 * available, even with no warehouse. The SIGNALS come from traces and can be missing.
 * So a `0` means "served nothing" only when the traces source is ok; when it is not,
 * the header says so and the numeric columns read as unknown rather than as zero.
 */
import { useMemo, useState } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Activity, AlertTriangle, CircleSlash, Layers, RefreshCw } from '@hanzogui/lucide-icons-2'
import { Button } from '@hanzo/gui'

import { AdminSubsystemsApi, telemetryDown, type Subsystem, type TimeRange } from '~/lib/api/admin-subsystems'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { SearchInput, Segmented } from '~/components/ui/Filters'
import { MetricCard } from '~/components/ui/Metric'
import { PageHeader } from '~/components/ui/PageHeader'
import { ErrorState, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import { useAdminResource } from '~/lib/hooks/useAdminResource'
import { distinctValues, useSort } from '~/lib/table'
import { DASH, ago, int, ms, pct } from '~/lib/format'

const RANGES: { label: string; value: TimeRange }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
]

/** The row's operational state — the one place the enabled/traffic rules are spelled. */
function stateOf(s: Subsystem): 'disabled' | 'erroring' | 'healthy' | 'idle' {
  if (!s.enabled) return 'disabled'
  if (s.errors > 0) return 'erroring'
  return s.requests > 0 ? 'healthy' : 'idle'
}

export function SubsystemsModule() {
  const [range, setRange] = useState<TimeRange>('24h')
  const { data, loading, err, reload } = useAdminResource(useMemo(() => () => AdminSubsystemsApi.board(range), [range]))

  const [q, setQ] = useState('')
  const [state, setState] = useState('all')
  const { sort, onSortChange, apply } = useSort('requests', 'desc')

  const all = data?.rows ?? []
  // With no telemetry the numeric columns are unknown, not zero — say which.
  const blind = data ? telemetryDown(data.sources) : false

  const stateOptions = useMemo(
    () => [{ label: 'All', value: 'all' }, ...distinctValues(all, stateOf).map((v) => ({ label: v, value: v }))],
    [all],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return apply(
      all.filter((s) => {
        if (state !== 'all' && stateOf(s) !== state) return false
        if (!needle) return true
        return `${s.name} ${s.prefixes.join(' ')} ${s.lastErrorRoute} ${s.lastErrorMessage}`.toLowerCase().includes(needle)
      }),
    )
  }, [all, q, state, apply])

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err)
    return (
      <YStack p="$4" gap="$4">
        <PageHeader title="Subsystems" />
        <ErrorState err={err} onRetry={reload} />
      </YStack>
    )

  const t = data?.totals
  const unknown = (v: string) => (blind ? DASH : v)

  const columns: Column<Subsystem>[] = [
    {
      key: 'name',
      header: 'Subsystem',
      sortable: true,
      render: (s) => (
        <YStack>
          <Text fontSize="$3" color="$color12" className="hz-mono">
            {s.name}
          </Text>
          <Text fontSize="$1" color="$color9" numberOfLines={1}>
            {s.prefixes.join('  ') || DASH}
          </Text>
        </YStack>
      ),
    },
    {
      key: 'enabled',
      header: 'State',
      width: 96,
      sortable: true,
      render: (s) => {
        const st = stateOf(s)
        const color = st === 'disabled' ? '$color9' : st === 'erroring' ? '$red10' : st === 'idle' ? '$color10' : '$green10'
        return (
          <Text fontSize="$2" color={color}>
            {st}
          </Text>
        )
      },
    },
    { key: 'requests', header: 'Requests', width: 96, align: 'right', mono: true, sortable: true, render: (s) => unknown(int(s.requests)) },
    { key: 'requestsPerMin', header: 'Req/min', width: 84, align: 'right', mono: true, sortable: true, render: (s) => unknown(String(s.requestsPerMin)) },
    {
      key: 'errorRate',
      header: 'Errors',
      width: 96,
      align: 'right',
      mono: true,
      sortable: true,
      render: (s) =>
        blind ? (
          DASH
        ) : (
          <Text fontSize="$3" className="hz-mono" color={s.errors > 0 ? '$red10' : '$color12'}>
            {s.errors > 0 ? `${int(s.errors)} (${pct(s.errorRate)})` : '0'}
          </Text>
        ),
    },
    { key: 'latencyP50Ms', header: 'p50', width: 76, align: 'right', mono: true, sortable: true, render: (s) => unknown(ms(s.latencyP50Ms)) },
    { key: 'latencyP95Ms', header: 'p95', width: 76, align: 'right', mono: true, sortable: true, render: (s) => unknown(ms(s.latencyP95Ms)) },
    { key: 'latencyP99Ms', header: 'p99', width: 76, align: 'right', mono: true, sortable: true, render: (s) => unknown(ms(s.latencyP99Ms)) },
    {
      key: 'lastErrorAt',
      header: 'Last error',
      width: 200,
      sortable: true,
      render: (s) =>
        !s.lastErrorAt ? (
          <Text fontSize="$2" color="$color9">
            {DASH}
          </Text>
        ) : (
          <YStack>
            <Text fontSize="$2" color="$red10" numberOfLines={1}>
              {s.lastErrorStatus ? `${s.lastErrorStatus} ` : ''}
              {s.lastErrorRoute || s.lastErrorMessage || 'error'}
            </Text>
            <Text fontSize="$1" color="$color9">
              {ago(s.lastErrorAt)}
            </Text>
          </YStack>
        ),
    },
  ]

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Subsystems"
        subtitle="Per-subsystem health across the one cloud binary — request rate, errors, latency, and last error."
        actions={
          <XStack gap="$2" items="center">
            <Segmented options={RANGES} value={range} onChange={(v) => setRange(v)} />
            <Button size="$2" chromeless icon={<RefreshCw size={15} />} onPress={() => void reload()} aria-label="Refresh" />
          </XStack>
        }
      />

      {blind ? (
        <XStack p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor" gap="$2" items="center">
          <AlertTriangle size={15} color="$yellow11" />
          <Text fontSize="$2" color="$color11">
            Trace warehouse unavailable — the inventory below is live, but request, error and latency columns are unknown (not zero).
          </Text>
        </XStack>
      ) : null}

      <XStack flexWrap="wrap" gap="$3">
        <MetricCard icon={<Layers size={16} />} label="Subsystems" value={int(t?.subsystems ?? 0)} caption={`${int(t?.enabled ?? 0)} enabled`} />
        <MetricCard icon={<Activity size={16} />} label="Reporting" value={int(t?.reporting ?? 0)} caption="served traffic in range" />
        <MetricCard icon={<CircleSlash size={16} />} label="Disabled" value={int(t?.disabled ?? 0)} caption="switched off in config" />
        <MetricCard icon={<Activity size={16} />} label="Requests" value={blind ? DASH : int(t?.requests ?? 0)} caption={blind ? 'no telemetry' : `${pct(t?.errorRate ?? 0)} errors`} />
      </XStack>

      <XStack gap="$2" items="center" flexWrap="wrap">
        <SearchInput value={q} onChange={setQ} placeholder="Search subsystems, routes, errors…" />
        <Segmented options={stateOptions} value={state} onChange={setState} />
      </XStack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(s) => s.name}
        sort={sort}
        onSortChange={onSortChange}
        dense
        empty={q || state !== 'all' ? 'No subsystems match this filter.' : 'No subsystems reported.'}
      />
    </YStack>
  )
}
