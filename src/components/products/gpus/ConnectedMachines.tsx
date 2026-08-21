'use client'

/**
 * Connected machines — the org's BYO fleet dialed in via `hanzo gpu connect`, with
 * LIVE heartbeat AND, now, LIVE work: each row carries its GPU utilization (from the
 * `/v1/visor/fleet` board) and its queue (running · queued, from `/v1/visor/fleet/jobs`), and
 * expands to show the running job + everything queued behind it, each cancelable. This
 * is where a user SEES their own hardware come online and SEES what it is doing.
 *
 * Honest by construction — loading paints skeleton rows, a load failure shows the shared
 * platform state card, a real empty list is the "connect a machine" prompt, and a GPU
 * with no telemetry/queue reads "—"/"idle", never a fabricated number. Every cell is a
 * real backend value derived with the pure fleet helpers.
 */
import { useState } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Cable, ChevronDown, ChevronRight, HardDrive, Zap } from '@hanzogui/lucide-icons-2'

import {
  type FleetWorker,
  type FleetJob,
  type FleetBoardUnit,
  acceleratorLabel,
  engineServing,
  fleetMemGb,
  fmtDuration,
  fmtHeartbeat,
  jobKey,
  onlineCount,
  queueSummary,
  queuedJobs,
  runningJobs,
  utilForWorker,
  workerOnline,
} from '~/lib/api/fleet'
import { UtilBar } from './charts'
import { JobStatusPill, CancelJobButton, FreshnessNote } from './job-ui'
import { PlatformStateCard } from '../platform/state'
import type { Async } from './state'
import { DataTable, EmptyState, type Column } from '@hanzo/ui/product'

const DASH = '—'

/** Online/offline pill — green when the box heartbeat is fresh (≤90s), red otherwise. */
function StatusPill({ w }: { w: FleetWorker }) {
  const online = workerOnline(w)
  return (
    <XStack items="center" gap="$1.5" aria-label={`Status ${online ? 'online' : 'offline'}`}>
      <YStack width={8} height={8} rounded="$10" bg={online ? '$green10' : '$red10'} />
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {online ? 'Online' : 'Offline'}
      </Text>
    </XStack>
  )
}

/** Utilization cell — the live GPU % from the board, honest `—` when no telemetry. */
function UtilCell({ pct }: { pct?: number }) {
  if (pct == null) return <Text fontSize="$3" color="$color10">{DASH}</Text>
  return (
    <XStack items="center" gap="$2" minW={0}>
      <UtilBar value={pct} width={64} />
      <Text fontSize="$2" color="$color11" className="hz-mono">{pct}%</Text>
    </XStack>
  )
}

/** The per-GPU queue panel shown when a row is expanded: EVERY running job (a multi-GPU
 *  box runs concurrent renders) + everything queued at this GPU, each cancelable; an honest
 *  "idle" when it has no work. */
function WorkerQueuePanel({
  worker,
  jobs,
  onCancel,
  isCanceling,
}: {
  worker: FleetWorker
  jobs: FleetJob[]
  onCancel: (job: FleetJob) => Promise<void>
  isCanceling: (job: FleetJob) => boolean
}) {
  const running = runningJobs(jobs, worker.id)
  const queued = queuedJobs(jobs, worker.id)
  const gpuName = worker.hostname || worker.id

  if (running.length === 0 && queued.length === 0) {
    return (
      <YStack p="$3.5">
        <Text fontSize="$2" color="$color10">Idle — no job running or queued on this GPU. It claims work from the org’s gpu-jobs queue as it arrives.</Text>
      </YStack>
    )
  }

  const JobRow = ({ job, tag }: { job: FleetJob; tag: string }) => (
    <XStack items="center" justify="space-between" gap="$3" py="$2" px="$3.5" borderTopWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$3" minW={0} flex={1}>
        <Text fontSize="$1" color="$color10" width={64} numberOfLines={1}>{tag}</Text>
        <YStack minW={0} flex={1}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{job.type || 'job'}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1} className="hz-mono">{job.id}</Text>
        </YStack>
      </XStack>
      <XStack items="center" gap="$3">
        <JobStatusPill status={job.status} canceling={isCanceling(job)} />
        <Text fontSize="$2" color="$color11" className="hz-mono" width={72} numberOfLines={1}>{fmtDuration(job.startTime, job.closeTime)}</Text>
        <CancelJobButton job={job} onCancel={onCancel} gpuName={gpuName} pending={isCanceling(job)} />
      </XStack>
    </XStack>
  )

  return (
    <YStack>
      {running.map((j, i) => (
        <JobRow key={jobKey(j)} job={j} tag={i === 0 ? 'Running' : ''} />
      ))}
      {queued.map((j, i) => (
        <JobRow key={jobKey(j)} job={j} tag={i === 0 ? 'Queued' : ''} />
      ))}
    </YStack>
  )
}

/**
 * The Connected-machines section: a heading with a live online tally and the fleet
 * table. Reused by the GPUs Overview and the GPUs tab so there is ONE connected-fleet
 * view. Rows expand to their per-GPU queue; `onConnect` opens the `hanzo gpu connect`
 * drawer; `onCancel` cancels a job.
 */
export function ConnectedMachines({
  workers,
  jobs,
  units,
  reload,
  onConnect,
  onCancel,
  isCanceling,
  updatedAt,
  stale,
}: {
  workers: Async<FleetWorker[]>
  jobs: Async<FleetJob[]>
  units: FleetBoardUnit[]
  reload: () => void
  onConnect: () => void
  onCancel: (job: FleetJob) => Promise<void>
  isCanceling: (job: FleetJob) => boolean
  updatedAt: number | null
  stale: boolean
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const rows = workers.phase === 'ready' ? workers.data : []
  const jobsReady = jobs.phase === 'ready'
  const jobList = jobsReady ? jobs.data : []
  const tally = workers.phase === 'ready' ? `${onlineCount(rows)} online · ${rows.length} connected` : 'via hanzo gpu connect'

  const columns: Column<FleetWorker>[] = [
    {
      key: 'name',
      header: 'Machine',
      render: (w) => {
        const open = expandedId === w.id
        return (
          <XStack items="center" gap="$2" minW={0}>
            {open ? <ChevronDown size={14} color="$color10" /> : <ChevronRight size={14} color="$color10" />}
            <HardDrive size={15} color="$color10" />
            <YStack minW={0}>
              <XStack items="center" gap="$1.5">
                <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{w.hostname || w.id}</Text>
                {engineServing(w) ? (
                  <XStack items="center" gap="$1" px="$1.5" height={18} rounded="$10" bg="$color3" aria-label="Serving models">
                    <Zap size={10} color="$color11" />
                    <Text fontSize="$1" color="$color11" fontWeight="700">Serving</Text>
                  </XStack>
                ) : null}
              </XStack>
              <Text fontSize="$1" color="$color10" numberOfLines={1}>
                {[w.os, w.version ? `v${w.version}` : null, w.location].filter(Boolean).join(' · ') || DASH}
              </Text>
            </YStack>
          </XStack>
        )
      },
    },
    { key: 'gpu', header: 'Accelerator', width: 170, render: (w) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{acceleratorLabel(w)}</Text> },
    { key: 'util', header: 'Utilization', width: 120, render: (w) => <UtilCell pct={utilForWorker(units, w.id)} /> },
    {
      key: 'queue',
      header: 'Queue',
      width: 130,
      render: (w) => {
        if (!jobsReady) return <Text fontSize="$2" color="$color10">{DASH}</Text>
        const summary = queueSummary(jobList, w.id)
        return <Text fontSize="$2" color={summary === 'idle' ? '$color10' : '$color12'} fontWeight={summary === 'idle' ? '400' : '600'} numberOfLines={1}>{summary}</Text>
      },
    },
    {
      key: 'mem',
      header: 'Memory',
      width: 96,
      render: (w) => {
        const gb = fleetMemGb(w)
        return <Text fontSize="$3" color="$color11">{gb != null ? `${gb} GB` : DASH}</Text>
      },
    },
    { key: 'status', header: 'Status', width: 96, render: (w) => <StatusPill w={w} /> },
    { key: 'hb', header: 'Last heartbeat', width: 120, render: (w) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtHeartbeat(w.lastHeartbeat)}</Text> },
  ]

  return (
    <YStack gap="$2" aria-label="Connected machines">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="800" color="$color12">Connected machines</Text>
        <XStack items="center" gap="$3" flexWrap="wrap">
          <FreshnessNote updatedAt={updatedAt} stale={stale} />
          <Text fontSize="$1" color="$color10">{tally}</Text>
        </XStack>
      </XStack>

      {workers.phase === 'error' ? (
        <PlatformStateCard error={workers.error} onRetry={reload} />
      ) : workers.phase === 'ready' && rows.length === 0 ? (
        <EmptyState
          icon={Cable}
          title="No machines connected yet"
          description="Bring a machine you already own — a workstation, a server, a GB10, a Mac — into your fleet. It dials out (NAT-safe), reports online within ~30s, and appears here with live heartbeat, utilization, and its job queue."
          bullets={[
            'Run hanzo gpu connect on the machine (or toggle it in Hanzo Desktop).',
            'It can run Studio renders and serve models — add --serve-engine to also serve OpenAI/Anthropic APIs.',
          ]}
          primary={{ label: 'Connect a machine', onPress: onConnect }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={workers.phase === 'loading'}
          rowKey={(w) => w.id}
          onRowPress={(w) => setExpandedId((cur) => (cur === w.id ? null : w.id))}
          isRowExpanded={(w) => expandedId === w.id}
          renderExpanded={(w) => <WorkerQueuePanel worker={w} jobs={jobList} onCancel={onCancel} isCanceling={isCanceling} />}
          empty="No machines connected — run hanzo gpu connect."
        />
      )}
    </YStack>
  )
}
