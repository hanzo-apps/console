'use client'

/**
 * GPUs · Pools — GPU scheduling pools (`GET /paas/gpus/pools`). Pools group capacity
 * for quota + scheduling; there is no pool backend yet, so this self-loads and renders
 * the honest not-configured / empty state — never fabricated pools.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack } from '@hanzo/gui'
import { Layers, RefreshCw } from '@hanzogui/lucide-icons-2'

import { ComputeApi, fmtInt, type GpuPool } from '~/lib/api/compute'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from '../platform/state'
import { DataTable, EmptyState, StatusTag, type Column } from '@hanzo/ui/product'

type State = { phase: 'loading' } | { phase: 'error'; error: PlatformError } | { phase: 'ready'; pools: GpuPool[] }

const columns: Column<GpuPool>[] = [
  { key: 'name', header: 'Pool', render: (p) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{p.name || p.id}</Text> },
  { key: 'model', header: 'Model', width: 120, render: (p) => <Text fontSize="$3" color="$color11">{p.model ?? '—'}</Text> },
  { key: 'size', header: 'Size', width: 100, render: (p) => <Text fontSize="$3" color="$color11">{fmtInt(p.size)}</Text> },
  { key: 'available', header: 'Available', width: 110, render: (p) => <Text fontSize="$3" color="$color11">{fmtInt(p.available)}</Text> },
  { key: 'status', header: 'Status', width: 120, render: (p) => <StatusTag status={p.status ?? 'unknown'} /> },
]

export function PoolsTab() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    ComputeApi.pools()
      .then((pools) => setState({ phase: 'ready', pools }))
      .catch((e) => setState({ phase: 'error', error: interpretPlatformError(e) }))
  }, [])

  useEffect(() => load(), [load])

  return (
    <>
      <XStack justify="flex-end">
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>
      </XStack>

      {state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center"><Spinner /><Text color="$color11">Loading pools…</Text></XStack>
      ) : state.phase === 'error' ? (
        <PlatformStateCard error={state.error} onRetry={load} />
      ) : state.pools.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No GPU pools yet"
          description="Pools group GPU capacity for scheduling, quota, and fair-share across teams. Create a pool once a GPU provider or cluster is connected."
          bullets={['Assign clusters or nodes to a pool', 'Set per-team quota and priority']}
        />
      ) : (
        <DataTable columns={columns} rows={state.pools} rowKey={(p) => p.id} empty="No GPU pools yet." />
      )}
    </>
  )
}
