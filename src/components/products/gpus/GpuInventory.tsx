'use client'

/**
 * The GPU inventory block — the table when real per-GPU rows exist, otherwise the
 * honest state for exactly why there are none: a real derived count from GPU clusters,
 * a not-configured platform card, or the first-run EmptyState. Shared by the Overview
 * and GPUs tabs (one way to render inventory).
 */
import { Spinner, Text, YStack, XStack } from '@hanzo/gui'
import { Cpu } from '@hanzogui/lucide-icons-2'

import { fmtInt, type Gpu, type GpuCluster, type GpuSummary } from '~/lib/api/compute'
import { PlatformStateCard } from '../platform/state'
import { GpuTable } from './GpuTable'
import type { Async } from './state'
import { EmptyState } from '@hanzo/ui/product'

export function GpuInventory({
  gpus,
  gpuClusters,
  summary,
  reload,
  onNav,
  pageSize = 10,
}: {
  gpus: Async<Gpu[]>
  gpuClusters: GpuCluster[]
  summary: GpuSummary
  reload: () => void
  onNav: (tab: string) => void
  pageSize?: number
}) {
  if (gpus.phase === 'loading') {
    return (
      <XStack p="$4" gap="$2" items="center">
        <Spinner />
        <Text color="$color11">Loading inventory…</Text>
      </XStack>
    )
  }
  if (gpus.phase === 'ready' && gpus.data.length > 0) {
    return <GpuTable gpus={gpus.data} pageSize={pageSize} />
  }
  // Real GPUs exist (we know counts from the clusters) but no per-GPU rows/telemetry.
  if (summary.source === 'clusters') {
    return (
      <YStack p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" rounded="$4">
        <Text fontSize="$3" color="$color12" fontWeight="600">
          {fmtInt(summary.total)} GPUs across {gpuClusters.length} cluster{gpuClusters.length === 1 ? '' : 's'} (from cluster inventory).
        </Text>
        <Text fontSize="$2" color="$color10">
          Per-GPU detail and live telemetry appear here when a GPU provider or node agent is connected.
        </Text>
      </YStack>
    )
  }
  if (gpus.phase === 'error') {
    return <PlatformStateCard error={gpus.error} onRetry={reload} />
  }
  return (
    <EmptyState
      icon={Cpu}
      title="No GPUs yet"
      description="Hanzo Cloud GPUs resell H100/A100 capacity over DigitalOcean and AWS, metered hourly. Connect a provider or create a GPU cluster to get started."
      bullets={[
        'Create a GPU cluster on your own DOKS in Clusters',
        'Per-GPU telemetry lights up once a provider or node agent is connected',
      ]}
      primary={{ label: 'Create cluster', onPress: () => onNav('clusters') }}
      secondary={{ label: 'View pricing', onPress: () => onNav('pricing') }}
    />
  )
}
