'use client'

/**
 * GPUs · Pools — the org's GPU NODE POOLS, read from its own clusters
 * (`data.clusters` ← `GET /v1/visor/clusters`, org-scoped by the caller's bearer).
 * A cluster carries its `nodePools` inline, so these ARE the per-cluster pools
 * (`/v1/visor/clusters/{clusterId}/pools`) in one read. The table is the shared
 * `CustomerPoolsTab` — one pools view for both routes; this adds the refresh and
 * the honest error card, so a failed cluster read never reads as "no pools".
 */
import { Button, XStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { PlatformStateCard } from '../platform/state'
import { CustomerPoolsTab } from './CustomerPoolsTab'
import type { ComputeData } from './state'

export function PoolsTab({ data }: { data: ComputeData }) {
  const { clusters } = data
  return (
    <>
      <XStack justify="flex-end">
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={data.reload}>Refresh</Button>
      </XStack>

      {clusters.phase === 'error' ? (
        <PlatformStateCard error={clusters.error} onRetry={data.reload} />
      ) : (
        <CustomerPoolsTab clusters={clusters} />
      )}
    </>
  )
}
