'use client'

/**
 * GPUs · Clusters — the org's DOKS clusters with GPU columns derived from the node
 * size, plus a REAL provision form. Listing reuses the shared `data.clusters`
 * (`GET /paas/org/{org}/cluster`); provisioning calls the REAL
 * `PlatformApi.provisionCluster` (`POST` same path). Honest not-configured card when
 * the PaaS token is unset; the node-size picker includes real DO GPU Droplet slugs so
 * "Create cluster" genuinely provisions GPU capacity once the token is wired.
 */
import { useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Plus } from '@hanzogui/lucide-icons-2'

import { ApiError, PlatformApi, DOKS_REGIONS, DOKS_NODE_SIZES, type Cluster } from '~/lib/api'
import { GPU_NODE_SIZES, gpuSpecOf } from '~/lib/api/compute'
import { currentOrg } from '~/lib/org-scope'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { FieldRow, FieldSelect } from '@hanzo/ui/product'
import { PlatformStateCard } from '../platform/state'
import type { ComputeData } from './state'

const NODE_SIZES = [...GPU_NODE_SIZES, ...DOKS_NODE_SIZES]

const gpuLabel = (c: Cluster): string => {
  const spec = gpuSpecOf(c.nodeSize)
  if (!spec) return '—'
  const nodes = c.nodeCount && c.nodeCount > 0 ? c.nodeCount : 1
  return `${spec.perNode * nodes} × ${spec.model}`
}

const clampCount = (v: string): number => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 100)
}

const columns: Column<Cluster>[] = [
  { key: 'name', header: 'Name', render: (c) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{c.name}</Text> },
  { key: 'status', header: 'Status', width: 130, render: (c) => <StatusTag status={c.phase || c.status} /> },
  { key: 'gpus', header: 'GPUs', width: 130, render: (c) => <Text fontSize="$3" color="$color11">{gpuLabel(c)}</Text> },
  { key: 'region', header: 'Region', width: 100, render: (c) => <Text fontSize="$3" color="$color11">{c.region ?? '—'}</Text> },
  { key: 'nodes', header: 'Nodes', width: 200, render: (c) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{c.nodeSize ? `${c.nodeSize} ×${c.nodeCount ?? 1}` : '—'}</Text> },
]

export function ClustersTab({ data }: { data: ComputeData }) {
  const { clusters } = data
  const [region, setRegion] = useState<string>(DOKS_REGIONS[2]) // sfo3
  const [nodeSize, setNodeSize] = useState<string>(GPU_NODE_SIZES[0])
  const [count, setCount] = useState(1)
  const [provisioning, setProvisioning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onProvision = async () => {
    setProvisioning(true)
    setError(null)
    try {
      await PlatformApi.provisionCluster(currentOrg(), { region, nodeSize, nodeCount: count })
      data.reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to provision cluster')
    } finally {
      setProvisioning(false)
    }
  }

  return (
    <YStack gap="$4">
      {clusters.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center"><Spinner /><Text color="$color11">Loading clusters…</Text></XStack>
      ) : clusters.phase === 'error' && clusters.error.kind !== 'error' ? (
        <PlatformStateCard error={clusters.error} onRetry={data.reload} />
      ) : (
        <>
          {clusters.phase === 'error' ? <Text color="$color12">{clusters.error.message}</Text> : null}
          <DataTable
            columns={columns}
            rows={clusters.phase === 'ready' ? clusters.data : []}
            rowKey={(c) => c.id || c.name}
            empty="No dedicated clusters yet. Provision a GPU cluster below, or keep running on shared Hanzo Cloud."
          />
        </>
      )}

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={480}>
        <Text fontSize="$5" fontWeight="700">Provision GPU cluster</Text>
        {error ? <Text color="#e5534b" fontSize="$2">{error}</Text> : null}
        <FieldRow label="Region">
          <FieldSelect value={region} options={[...DOKS_REGIONS]} onChange={setRegion} />
        </FieldRow>
        <FieldRow label="Node size">
          <FieldSelect value={nodeSize} options={NODE_SIZES} onChange={setNodeSize} />
        </FieldRow>
        <FieldRow label="Node count">
          <FieldSelect value={String(count)} options={['1', '2', '3', '4', '5', '6', '8', '10']} onChange={(v) => setCount(clampCount(v))} />
        </FieldRow>
        <XStack>
          <Button theme="light" icon={<Plus size={16} />} disabled={provisioning} onPress={() => void onProvision()}>
            {provisioning ? 'Provisioning…' : 'Create cluster'}
          </Button>
        </XStack>
        <Text fontSize="$2" color="$color10">
          Spins up a DigitalOcean Kubernetes cluster (GPU Droplets for the gpu-* sizes), installs the Hanzo
          operator, and makes it your deploy target. Billed hourly by DigitalOcean and metered to your account.
        </Text>
      </Card>
    </YStack>
  )
}
