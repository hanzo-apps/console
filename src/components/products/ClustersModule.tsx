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
 * Cluster inventory + node-pool lifecycle (list, add-pool, scale-pool, delete-pool)
 * read/write the native cloud `/v1/clusters*` surface (org-scoped by the Bearer
 * owner); provisioning a brand-new dedicated cluster stays on the `/paas` control
 * plane (`POST /v1/org/{org}/cluster`, brand-admin gated). Tenancy is the brand org
 * (`config.iamOrgName`). Built on the shared GUI primitives, matching every module.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, RefreshCw, Trash2 } from '@hanzogui/lucide-icons-2'

import { ApiError, PlatformApi, DOKS_REGIONS, DOKS_NODE_SIZES, type Cluster, type NodePool } from '~/lib/api'
import { config } from '~/config'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'
import { DataTable, FieldRow, FieldSelect, PageHeader, StatusTag, type Column } from '@hanzo/ui/product'

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

/** Node-count options for the pool scale / add selects. */
const COUNT_OPTIONS = ['1', '2', '3', '4', '5', '6', '8', '10']

/** Stable id for a cluster / node pool across the platform's field aliases. */
const clusterId = (c: Cluster): string => c.doksClusterId ?? c.id ?? c.name
const poolId = (p: NodePool): string => p.poolId ?? p.doPoolId ?? p.name ?? ''

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
      const data = await PlatformApi.listClusters()
      setRows(data ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
    } finally {
      setLoading(false)
    }
  }, [])

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
      setError(e instanceof ApiError ? e.message : 'The cluster was not provisioned. Check the region and node size, then try again.')
    } finally {
      setProvisioning(false)
    }
  }

  // ── Node-pool management (add / scale / delete against /v1/clusters/:cid/pools) ──
  const [poolClusterId, setPoolClusterId] = useState<string>('')
  const [addSize, setAddSize] = useState<string>(DOKS_NODE_SIZES[0])
  const [addCount, setAddCount] = useState(1)
  const [scaleCounts, setScaleCounts] = useState<Record<string, number>>({})
  const [poolBusy, setPoolBusy] = useState(false)
  const [poolMsg, setPoolMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  // The cluster whose pools are being managed (defaults to the first cluster).
  const selectedCluster = useMemo(
    () => rows.find((c) => clusterId(c) === poolClusterId) ?? rows[0] ?? null,
    [rows, poolClusterId],
  )

  const runPool = async (fn: () => Promise<void>, ok: string) => {
    setPoolBusy(true)
    setPoolMsg(null)
    try {
      await fn()
      setPoolMsg({ tone: 'ok', text: ok })
      await load()
    } catch (e) {
      setPoolMsg({ tone: 'err', text: e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Pool operation failed' })
    } finally {
      setPoolBusy(false)
    }
  }

  const onAddPool = (c: Cluster) =>
    void runPool(() => PlatformApi.addPool(clusterId(c), { size: addSize, count: addCount }), 'Node pool added.')

  const onScalePool = (c: Cluster, p: NodePool) =>
    void runPool(
      () => PlatformApi.scalePool(clusterId(c), poolId(p), scaleCounts[poolId(p)] ?? p.count ?? 1),
      'Node pool scaled.',
    )

  const onDeletePool = (c: Cluster, p: NodePool) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete node pool “${p.name || poolId(p)}”? Its machines are destroyed and cannot be brought back — add a new pool to replace the capacity.`)) return
    void runPool(() => PlatformApi.deletePool(clusterId(c), poolId(p)), 'Node pool removed.')
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

          {/* Node pools — add / scale / delete on a dedicated cluster. */}
          {selectedCluster ? (
            <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={620}>
              <Text fontSize="$5" fontWeight="700">
                Node pools
              </Text>
              {rows.length > 1 ? (
                <FieldRow label="Cluster">
                  <FieldSelect
                    value={clusterId(selectedCluster)}
                    options={rows.map(clusterId)}
                    onChange={setPoolClusterId}
                  />
                </FieldRow>
              ) : null}

              {selectedCluster.nodePools && selectedCluster.nodePools.length ? (
                <YStack gap="$2">
                  {selectedCluster.nodePools.map((p) => (
                    <XStack key={poolId(p)} gap="$2" items="center" flexWrap="wrap">
                      <YStack flex={1} minW={160}>
                        <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
                          {p.name || poolId(p) || '—'}
                        </Text>
                        <Text fontSize="$1" color="$color10">
                          {(p.size ?? '—')} · {p.count ?? 0} node{(p.count ?? 0) === 1 ? '' : 's'}
                        </Text>
                      </YStack>
                      <FieldSelect
                        value={String(scaleCounts[poolId(p)] ?? p.count ?? 1)}
                        options={COUNT_OPTIONS}
                        onChange={(v) => setScaleCounts((s) => ({ ...s, [poolId(p)]: clampCount(v) }))}
                      />
                      <Button size="$2" disabled={poolBusy} onPress={() => onScalePool(selectedCluster, p)}>
                        Scale
                      </Button>
                      <Button
                        size="$2"
                        chromeless
                        theme="red"
                        icon={<Trash2 size={14} />}
                        disabled={poolBusy}
                        onPress={() => onDeletePool(selectedCluster, p)}
                        aria-label={`Delete pool ${p.name || poolId(p)}`}
                      />
                    </XStack>
                  ))}
                </YStack>
              ) : (
                <Text fontSize="$2" color="$color10">
                  This cluster reports no node pools.
                </Text>
              )}

              <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
                <Text fontSize="$3" fontWeight="700">
                  Add node pool
                </Text>
                <FieldRow label="Size">
                  <FieldSelect value={addSize} options={[...DOKS_NODE_SIZES]} onChange={setAddSize} />
                </FieldRow>
                <FieldRow label="Nodes">
                  <FieldSelect value={String(addCount)} options={COUNT_OPTIONS} onChange={(v) => setAddCount(clampCount(v))} />
                </FieldRow>
                <XStack gap="$3" items="center">
                  <Button self="flex-start" icon={<Plus size={16} />} disabled={poolBusy} onPress={() => onAddPool(selectedCluster)}>
                    {poolBusy ? 'Working…' : 'Add pool'}
                  </Button>
                  {poolMsg ? (
                    <Text fontSize="$2" color={poolMsg.tone === 'ok' ? '$color11' : '$red10'}>
                      {poolMsg.text}
                    </Text>
                  ) : null}
                </XStack>
              </YStack>
            </Card>
          ) : null}
        </>
      )}
    </>
  )
}
