'use client'

/**
 * GPUs · Pools — a pool is a GPU node pool of a real cluster, so it is DERIVED from the
 * clusters this module already loaded (`gpuPoolsFromClusters`, the same pure function the
 * customer tab reads). It used to fetch a pool inventory of its own; nothing served that
 * address, and after visor folded to `/v1/visor/*` there is no head left for it to reach,
 * so the read is gone rather than repointed at a second spelling of nothing.
 *
 * An org with no GPU-bearing cluster has no pools — an honest empty state, never a
 * fabricated pool.
 */
import { useMemo } from 'react'
import { Spinner, Text, XStack } from '@hanzo/gui'
import { Layers } from '@hanzogui/lucide-icons-2'

import { fmtInt, type GpuPool } from '~/lib/api/compute'
import { gpuPoolsFromClusters } from './customer-logic'
import { PlatformStateCard } from '../platform/state'
import type { ComputeData } from './state'
import { DataTable, EmptyState, StatusTag, type Column } from '@hanzo/ui/product'

const columns: Column<GpuPool>[] = [
  { key: 'name', header: 'Pool', render: (p) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{p.name || p.id}</Text> },
  { key: 'model', header: 'Model', width: 120, render: (p) => <Text fontSize="$3" color="$color11">{p.model ?? '—'}</Text> },
  { key: 'size', header: 'Size', width: 100, render: (p) => <Text fontSize="$3" color="$color11">{fmtInt(p.size)}</Text> },
  { key: 'available', header: 'Available', width: 110, render: (p) => <Text fontSize="$3" color="$color11">{p.available == null ? '—' : fmtInt(p.available)}</Text> },
  { key: 'status', header: 'Cluster', width: 130, render: (p) => <StatusTag status={p.status ?? 'unknown'} /> },
]

export function PoolsTab({ data }: { data: ComputeData }) {
  const { clusters } = data
  const pools = useMemo(
    () => (clusters.phase === 'ready' ? gpuPoolsFromClusters(clusters.data) : []),
    [clusters],
  )

  if (clusters.phase === 'loading') {
    return <XStack p="$4" gap="$2" items="center"><Spinner /><Text color="$color11">Loading pools…</Text></XStack>
  }
  if (clusters.phase === 'error') {
    return <PlatformStateCard error={clusters.error} onRetry={data.reload} />
  }
  if (pools.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No GPU pools yet"
        description="Pools group GPU capacity for scheduling, quota, and fair-share across orgs. Create a GPU cluster and its node pools appear here."
        bullets={['Assign clusters or nodes to a pool', 'Set per-org quota and priority']}
      />
    )
  }
  return <DataTable columns={columns} rows={pools} rowKey={(p) => p.id} empty="No GPU pools yet." />
}
