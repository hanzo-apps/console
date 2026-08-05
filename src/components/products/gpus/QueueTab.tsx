'use client'

/**
 * Queue — the org's gpu-jobs queue + history, per GPU, on ONE board. Every connected
 * GPU claims work from the org's `gpu-jobs` namespace; this is where a user SEES that
 * work: what's running on which GPU, what's queued behind it, and what recently ran —
 * with a confirm-gated Cancel for anything still in flight. Presentational: it renders
 * the live jobs the parent polls (`useFleetLive`) and derives its rows with the pure
 * fleet helpers, so nothing here is fabricated — an empty queue is the honest "nothing
 * running" state, and the history is rendered exactly as the backend (recency-bounded)
 * returns it.
 */
import { useMemo } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { ListChecks } from '@hanzogui/lucide-icons-2'

import {
  fmtDuration,
  fmtHeartbeat,
  isTerminal,
  jobActive,
  jobKey,
  queueDepth,
  runningCount,
  type FleetJob,
  type FleetWorker,
} from '~/lib/api/fleet'
import { PlatformStateCard } from '../platform/state'
import { JobStatusPill, CancelJobButton, FreshnessNote } from './job-ui'
import type { Async } from './state'
import { DataTable, EmptyState, type Column } from '@hanzo/ui/product'

const DASH = '—'

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <YStack flex={1} minW={150} p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1">
      <Text fontSize="$2" color="$color11" fontWeight="600">{label}</Text>
      <Text fontSize="$8" fontWeight="900" color="$color12" numberOfLines={1} className="hz-mono">{value}</Text>
      {sub ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{sub}</Text> : null}
    </YStack>
  )
}

/** Which GPU a job belongs to, as a label: the claiming worker (running) or the target
 *  node (queued), mapped to its hostname; a shared-pool job (no target) reads so. PURE. */
function gpuLabel(job: FleetJob, nameOf: (id: string) => string): string {
  const id = job.worker || job.gpu
  if (!id) return 'shared pool'
  return nameOf(id)
}

/** The job columns, shared by the Active + History tables. `onCancel` is omitted on the
 *  history table (terminal jobs are not cancelable). */
function jobColumns(
  nameOf: (id: string) => string,
  isCanceling: (job: FleetJob) => boolean,
  onCancel?: (job: FleetJob) => Promise<void>,
): Column<FleetJob>[] {
  return [
    {
      key: 'job',
      header: 'Job',
      render: (j) => (
        <YStack minW={0}>
          <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>{j.type || 'job'}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1} className="hz-mono">{j.id}</Text>
        </YStack>
      ),
    },
    { key: 'gpu', header: 'GPU', width: 150, render: (j) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{gpuLabel(j, nameOf)}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (j) => <JobStatusPill status={j.status} canceling={isCanceling(j)} /> },
    { key: 'started', header: 'Started', width: 110, render: (j) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtHeartbeat(j.startTime)}</Text> },
    { key: 'dur', header: 'Duration', width: 100, mono: true, render: (j) => <Text fontSize="$2" color="$color11" className="hz-mono">{fmtDuration(j.startTime, j.closeTime)}</Text> },
    { key: 'attempt', header: 'Try', width: 56, align: 'right', mono: true, render: (j) => <Text fontSize="$2" color="$color11" className="hz-mono">{j.attempt != null ? String(j.attempt) : DASH}</Text> },
    {
      key: 'actions',
      header: '',
      width: 96,
      align: 'right',
      render: (j) =>
        onCancel ? (
          <XStack justify="flex-end">
            <CancelJobButton job={j} onCancel={onCancel} gpuName={gpuLabel(j, nameOf)} pending={isCanceling(j)} />
          </XStack>
        ) : j.failureCause ? (
          <Text fontSize="$1" color="$red10" numberOfLines={1}>{j.failureCause}</Text>
        ) : null,
    },
  ]
}

export function QueueTab({
  jobs,
  workers,
  onCancel,
  isCanceling,
  updatedAt,
  stale,
  reload,
}: {
  jobs: Async<FleetJob[]>
  workers: FleetWorker[]
  onCancel: (job: FleetJob) => Promise<void>
  isCanceling: (job: FleetJob) => boolean
  updatedAt: number | null
  stale: boolean
  reload: () => void
}) {
  const nameOf = useMemo(() => {
    const m = new Map(workers.map((w) => [w.id, w.hostname || w.id]))
    return (id: string) => m.get(id) ?? id
  }, [workers])

  const rows = jobs.phase === 'ready' ? jobs.data : []
  // Active first: running before queued, oldest queued at the top (FIFO). History after,
  // most-recently-closed first — rendered as the backend returns it (recency-bounded there,
  // never client-truncated).
  const active = useMemo(
    () =>
      rows
        .filter(jobActive)
        .sort((a, b) => (a.status === b.status ? (a.startTime ?? '').localeCompare(b.startTime ?? '') : a.status === 'running' ? -1 : 1)),
    [rows],
  )
  const history = useMemo(
    () => rows.filter((j) => isTerminal(j.status)).sort((a, b) => (b.closeTime ?? b.startTime ?? '').localeCompare(a.closeTime ?? a.startTime ?? '')),
    [rows],
  )

  const activeCols = useMemo(() => jobColumns(nameOf, isCanceling, onCancel), [nameOf, isCanceling, onCancel])
  const historyCols = useMemo(() => jobColumns(nameOf, isCanceling), [nameOf, isCanceling])

  if (jobs.phase === 'error') return <PlatformStateCard error={jobs.error} onRetry={reload} />

  return (
    <YStack gap="$4">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="800" color="$color12">Queue</Text>
        <FreshnessNote updatedAt={updatedAt} stale={stale} />
      </XStack>

      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <StatCard label="Running" value={String(runningCount(rows))} sub="in flight now" />
        <StatCard label="Queued" value={String(queueDepth(rows))} sub="waiting for a GPU" />
        <StatCard label="History" value={String(history.length)} sub="recent completed/failed" />
      </XStack>

      <YStack gap="$2">
        <Text fontSize="$4" fontWeight="800" color="$color12">Active</Text>
        {jobs.phase === 'ready' && active.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nothing running or queued"
            description="When a Studio render (or any gpu-job) is dispatched to your fleet, it appears here — running on the GPU that claimed it, with anything queued behind it. Cancel a job any time it is still in flight."
          />
        ) : (
          <DataTable columns={activeCols} rows={active} loading={jobs.phase === 'loading'} rowKey={jobKey} empty="No active jobs." />
        )}
      </YStack>

      {history.length ? (
        <YStack gap="$2">
          <Text fontSize="$4" fontWeight="800" color="$color12">Recent history</Text>
          <DataTable columns={historyCols} rows={history} rowKey={jobKey} empty="No history yet." />
        </YStack>
      ) : null}
    </YStack>
  )
}
