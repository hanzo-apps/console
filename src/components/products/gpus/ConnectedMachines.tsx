'use client'

/**
 * Connected machines — the org's BYO fleet dialed in via `hanzo gpu connect`, with
 * LIVE heartbeat, read from `GET /v1/fleet/workers` (`FleetApi.workers`). This is the
 * ONE surface that carries the per-box `lastHeartbeat`, so it is where a user SEES
 * their own hardware (a workstation, a GB10, a Mac) come online: name, accelerator
 * (arch), memory, online/offline, and when it last checked in.
 *
 * Honest by construction — loading paints skeleton rows, a load failure shows the
 * shared platform state card (never an empty grid masquerading as "you have none"),
 * and a real empty list is the "connect a machine" prompt. Nothing is fabricated;
 * every cell is a real backend value or "—".
 */
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Cable, HardDrive, Zap } from '@hanzogui/lucide-icons-2'

import {
  type FleetWorker,
  acceleratorLabel,
  engineServing,
  fleetMemGb,
  fmtHeartbeat,
  onlineCount,
  workerOnline,
} from '~/lib/api/fleet'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { PlatformStateCard } from '../platform/state'
import type { Async } from './state'

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

const columns: Column<FleetWorker>[] = [
  {
    key: 'name',
    header: 'Machine',
    render: (w) => (
      <XStack items="center" gap="$2" minW={0}>
        <HardDrive size={15} color="$color10" />
        <YStack minW={0}>
          <XStack items="center" gap="$1.5">
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
              {w.hostname || w.id}
            </Text>
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
    ),
  },
  { key: 'gpu', header: 'Accelerator', width: 180, render: (w) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{acceleratorLabel(w)}</Text> },
  {
    key: 'mem',
    header: 'Memory',
    width: 100,
    render: (w) => {
      const gb = fleetMemGb(w)
      return <Text fontSize="$3" color="$color11">{gb != null ? `${gb} GB` : DASH}</Text>
    },
  },
  { key: 'status', header: 'Status', width: 100, render: (w) => <StatusPill w={w} /> },
  { key: 'hb', header: 'Last heartbeat', width: 130, render: (w) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtHeartbeat(w.lastHeartbeat)}</Text> },
]

/**
 * The Connected-machines section: a heading with a live online tally and the fleet
 * table. Reused by the GPUs Overview and the GPUs tab so there is ONE connected-fleet
 * view. `onConnect` opens the `hanzo gpu connect` drawer.
 */
export function ConnectedMachines({
  workers,
  reload,
  onConnect,
}: {
  workers: Async<FleetWorker[]>
  reload: () => void
  onConnect: () => void
}) {
  const rows = workers.phase === 'ready' ? workers.data : []
  const tally = workers.phase === 'ready' ? `${onlineCount(rows)} online · ${rows.length} connected` : 'via hanzo gpu connect'

  return (
    <YStack gap="$2" aria-label="Connected machines">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="800" color="$color12">Connected machines</Text>
        <Text fontSize="$1" color="$color10">{tally}</Text>
      </XStack>

      {workers.phase === 'error' ? (
        <PlatformStateCard error={workers.error} onRetry={reload} />
      ) : workers.phase === 'ready' && rows.length === 0 ? (
        <EmptyState
          icon={Cable}
          title="No machines connected yet"
          description="Bring a machine you already own — a workstation, a server, a GB10, a Mac — into your fleet. It dials out (NAT-safe), reports online within ~30s, and appears here with live heartbeat."
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
          empty="No machines connected — run hanzo gpu connect."
        />
      )}
    </YStack>
  )
}
