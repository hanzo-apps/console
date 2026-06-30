'use client'

/**
 * GPUs · GPUs — the full inventory table with a real summary strip. Reuses the
 * shared `GpuInventory` (table or honest state) so Overview and this tab never drift.
 */
import { useMemo } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { gpuClustersOf, summarize, fmtInt, fmtPct, type Gpu } from '~/lib/api/compute'
import { GpuInventory } from './GpuInventory'
import type { ComputeData } from './state'

const Stat = ({ label, value }: { label: string; value: string }) => (
  <YStack gap="$1" minW={120}>
    <Text fontSize="$2" color="$color11">{label}</Text>
    <Text fontSize="$6" fontWeight="900" color="$color12">{value}</Text>
  </YStack>
)

export function GpusTab({ data, onNav }: { data: ComputeData; onNav: (tab: string) => void }) {
  const { gpus, clusters } = data
  const gpuRows: Gpu[] = gpus.phase === 'ready' ? gpus.data : []
  const gpuClusters = useMemo(() => (clusters.phase === 'ready' ? gpuClustersOf(clusters.data) : []), [clusters])
  const summary = useMemo(() => summarize(gpus.phase === 'ready', gpuRows, gpuClusters), [gpus.phase, gpuRows, gpuClusters])

  return (
    <YStack gap="$4">
      <XStack gap="$5" flexWrap="wrap" items="center" justify="space-between">
        <XStack gap="$5" flexWrap="wrap">
          <Stat label="Total GPUs" value={summary.total == null ? '—' : fmtInt(summary.total)} />
          <Stat label="Online" value={summary.online == null ? '—' : fmtInt(summary.online)} />
          <Stat label="Utilization avg" value={fmtPct(summary.utilAvg)} />
          <Stat label="Models" value={fmtInt(summary.byModel.length)} />
        </XStack>
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={data.reload}>Refresh</Button>
      </XStack>

      <GpuInventory gpus={gpus} gpuClusters={gpuClusters} summary={summary} reload={data.reload} onNav={onNav} pageSize={12} />
    </YStack>
  )
}
