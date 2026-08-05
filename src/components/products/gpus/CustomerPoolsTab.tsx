'use client'

/**
 * GPUs · Pools (customer) — the org's GPU NODE POOLS, derived from its OWN clusters
 * (`data.clusters` ← the user-bearer `/v1/clusters`, org-scoped). A pool is a
 * cluster node pool whose size is a GPU Droplet/instance; we show the real per-pool GPU
 * total and the cluster's real state. No pool backend is invented: an org with no GPU
 * clusters sees an honest "No node pools yet" (never fabricated pools, never the admin
 * `/paas/gpus/pools` fleet).
 */
import { useMemo } from 'react'
import { Spinner, Text, XStack } from '@hanzo/gui'
import { Layers } from '@hanzogui/lucide-icons-2'

import { fmtInt, type GpuPool } from '~/lib/api/compute'
import type { Cluster } from '~/lib/api'
import { gpuPoolsFromClusters } from './customer-logic'
import type { Async } from './state'
import { DataTable, EmptyState, StatusTag, type Column } from '@hanzo/ui/product'

const columns: Column<GpuPool>[] = [
  { key: 'name', header: 'Pool', render: (p) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{p.name || p.id}</Text> },
  { key: 'model', header: 'Model', width: 120, render: (p) => <Text fontSize="$3" color="$color11">{p.model ?? '—'}</Text> },
  { key: 'size', header: 'GPUs', width: 90, render: (p) => <Text fontSize="$3" color="$color11">{fmtInt(p.size)}</Text> },
  { key: 'available', header: 'Available', width: 110, render: (p) => <Text fontSize="$3" color="$color11">{p.available == null ? '—' : fmtInt(p.available)}</Text> },
  { key: 'status', header: 'Cluster', width: 130, render: (p) => <StatusTag status={p.status ?? 'unknown'} /> },
]

export function CustomerPoolsTab({ clusters }: { clusters: Async<Cluster[]> }) {
  // Pools are DERIVED from the org's own clusters; a pool is a GPU node pool of a real
  // cluster. When the org has no reachable GPU clusters (none provisioned, or the native
  // clusters endpoint isn't live on this deployment), there are no pools to show — an
  // honest empty, distinct from the Clusters tab and never a fabricated pool.
  const pools = useMemo(
    () => (clusters.phase === 'ready' ? gpuPoolsFromClusters(clusters.data) : []),
    [clusters],
  )

  if (clusters.phase === 'loading') {
    return <XStack p="$4" gap="$2" items="center"><Spinner /><Text color="$color11">Loading pools…</Text></XStack>
  }
  if (pools.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No GPU node pools yet"
        description="A node pool is a set of identical GPU nodes inside one of your dedicated GPU clusters. Provision a GPU cluster (Clusters tab) to add a pool; until then your workloads run on shared Hanzo Cloud — no pool to manage."
        bullets={['Pools come from your own GPU clusters (real per-org data).', 'Each pool shows its accelerator model and node-count-derived GPU total.']}
      />
    )
  }
  return (
    <DataTable columns={columns} rows={pools} rowKey={(p) => p.id} empty="No GPU node pools yet." />
  )
}
