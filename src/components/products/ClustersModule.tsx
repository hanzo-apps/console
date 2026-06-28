'use client'

/**
 * Clusters admin — the control-plane surface for your DEDICATED Hanzo K8S.
 *
 * The platform can provision an org its OWN DigitalOcean Kubernetes cluster,
 * install the hanzo-operator + per-tenant baseline, and make it the org's deploy
 * target (the DO token is read from KMS server-side; the kubeconfig is never
 * stored or returned). Workloads otherwise run on the shared Hanzo Cloud — which
 * is the default target, not a row here, so an org with no dedicated cluster sees
 * an honest empty list.
 *
 * Talks to the Hanzo PaaS via the same-origin `/paas` proxy (`GET|POST
 * /v1/org/{org}/cluster`). Tenancy is the brand org (`config.iamOrgName`). Built
 * on the shared GUI primitives, matching every other module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, RefreshCw } from '@hanzogui/lucide-icons-2'

import { ApiError, PlatformApi, DOKS_REGIONS, DOKS_NODE_SIZES, type Cluster } from '~/lib/api'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { FieldRow, FieldSelect } from '~/components/ui/Field'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const KindTag = ({ kind }: { kind?: string }) => (
  <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
    {kind === 'shared' ? 'Shared' : kind === 'byo' ? 'BYO' : kind || 'Dedicated'}
  </Text>
)

const clampCount = (v: string): number => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 100)
}

export function ClustersModule(_props: { params: Record<string, string> }) {
  const org = config.iamOrgName
  const [rows, setRows] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  // List-load failure (separate from action errors) — drives the honest
  // not-configured / backend-unavailable card.
  const [loadError, setLoadError] = useState<PlatformError | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Provision form (the platform generates the cluster name).
  const [pRegion, setPRegion] = useState<string>(DOKS_REGIONS[2]) // sfo3
  const [pNodeSize, setPNodeSize] = useState<string>(DOKS_NODE_SIZES[1])
  const [pCount, setPCount] = useState(3)
  const [provisioning, setProvisioning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await PlatformApi.listClusters(org)
      setRows(data ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
    } finally {
      setLoading(false)
    }
  }, [org])

  useEffect(() => {
    void load()
  }, [load])

  const onProvision = async () => {
    setProvisioning(true)
    setError(null)
    try {
      await PlatformApi.provisionCluster(org, {
        region: pRegion,
        nodeSize: pNodeSize,
        nodeCount: pCount,
      })
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to provision cluster')
    } finally {
      setProvisioning(false)
    }
  }

  const columns: Column<Cluster>[] = [
    { key: 'name', header: 'Name', render: (c) => <Text fontSize="$3" fontWeight="600">{c.name}</Text> },
    { key: 'status', header: 'Status', width: 130, render: (c) => <StatusTag status={c.phase || c.status} /> },
    { key: 'kind', header: 'Kind', width: 110, render: (c) => <KindTag kind={c.kind} /> },
    { key: 'region', header: 'Region', width: 100, render: (c) => <Text fontSize="$3" color="$color11">{c.region ?? '—'}</Text> },
    {
      key: 'nodes',
      header: 'Nodes',
      width: 180,
      render: (c) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {c.nodeSize ? `${c.nodeSize} ×${c.nodeCount ?? 1}` : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Clusters"
        subtitle="Your dedicated Hanzo K8S (DigitalOcean Kubernetes). Workloads otherwise run on shared Hanzo Cloud."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError && loadError.kind !== 'error' ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <>
          {loadError ? <Text color="$color12">{loadError.message}</Text> : null}
          {error ? <Text color="$color12">{error}</Text> : null}

          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(c) => c.id || c.name}
            empty="No dedicated clusters yet. Provision one below, or keep running on shared Hanzo Cloud."
          />

          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={460}>
            <Text fontSize="$5" fontWeight="700">
              Provision dedicated cluster
            </Text>
            <FieldRow label="Region">
              <FieldSelect value={pRegion} options={[...DOKS_REGIONS]} onChange={setPRegion} />
            </FieldRow>
            <FieldRow label="Node size">
              <FieldSelect value={pNodeSize} options={[...DOKS_NODE_SIZES]} onChange={setPNodeSize} />
            </FieldRow>
            <FieldRow label="Node count">
              <FieldSelect
                value={String(pCount)}
                options={['1', '2', '3', '4', '5', '6', '8', '10']}
                onChange={(v) => setPCount(clampCount(v))}
              />
            </FieldRow>
            <XStack>
              <Button
                theme="light"
                icon={<Plus size={16} />}
                disabled={provisioning}
                onPress={() => void onProvision()}
              >
                {provisioning ? 'Provisioning…' : 'Provision'}
              </Button>
            </XStack>
            <Text fontSize="$2" color="$color10">
              Spins up a DigitalOcean Kubernetes cluster, installs the Hanzo operator, and makes it
              your deploy target. Billed by DigitalOcean.
            </Text>
          </Card>
        </>
      )}
    </>
  )
}
