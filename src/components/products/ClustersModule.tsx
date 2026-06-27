'use client'

/**
 * Clusters admin — the one control-plane surface for *where* workloads run.
 *
 * Two targets, one list:
 *   - Provision a fresh DOKS cluster (region / node size / count) — the platform
 *     creates node pools and reconciles your apps + managed products into it.
 *   - Attach an existing cluster (name + kubeconfig) the operator should adopt.
 *
 * Talks to the Hanzo PaaS (config.platformUrl) via PlatformApi. Tenancy is
 * server-side (X-Org-Id from the session). Built on the shared GUI primitives +
 * DataTable/PageHeader/Field, matching every other module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, Trash, RefreshCw, Link2 } from '@hanzogui/lucide-icons-2'

import {
  ApiError,
  PlatformApi,
  DOKS_REGIONS,
  DOKS_NODE_SIZES,
  type Cluster,
} from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { FieldRow, FieldText, FieldTextArea, FieldSelect } from '~/components/ui/Field'
import { slugError } from '~/lib/slug'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const KindTag = ({ kind }: { kind?: string }) => (
  <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
    {kind === 'shared' ? 'Shared' : kind === 'byo' ? 'BYO' : kind || '—'}
  </Text>
)

const clampCount = (v: string): number => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 100)
}

export function ClustersModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // List-load failure (separate from action errors) — drives the honest
  // not-configured / backend-unavailable card.
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  // Provision form.
  const [pName, setPName] = useState('')
  const [pRegion, setPRegion] = useState<string>(DOKS_REGIONS[0])
  const [pNodeSize, setPNodeSize] = useState<string>(DOKS_NODE_SIZES[1])
  const [pCount, setPCount] = useState(3)
  const [provisioning, setProvisioning] = useState(false)

  // Attach form.
  const [aName, setAName] = useState('')
  const [aKubeconfig, setAKubeconfig] = useState('')
  const [attaching, setAttaching] = useState(false)

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

  const pNameErr = pName ? slugError(pName) : null
  const aNameErr = aName ? slugError(aName) : null

  const onProvision = async () => {
    const err = slugError(pName)
    if (err) {
      setError(err)
      return
    }
    setProvisioning(true)
    setError(null)
    try {
      await PlatformApi.provisionCluster({
        name: pName,
        region: pRegion,
        nodeSize: pNodeSize,
        nodeCount: pCount,
      })
      setPName('')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to provision cluster')
    } finally {
      setProvisioning(false)
    }
  }

  const onAttach = async () => {
    const err = slugError(aName)
    if (err) {
      setError(err)
      return
    }
    if (!aKubeconfig.trim()) {
      setError('Paste the cluster kubeconfig to attach.')
      return
    }
    setAttaching(true)
    setError(null)
    try {
      await PlatformApi.attachCluster({ name: aName, kubeconfig: aKubeconfig })
      setAName('')
      setAKubeconfig('')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to attach cluster')
    } finally {
      setAttaching(false)
    }
  }

  const onDelete = async (c: Cluster) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Remove cluster "${c.name}"? Workloads on it will be detached.`)
    )
      return
    try {
      await PlatformApi.removeCluster(c.name)
      setRows((rs) => rs.filter((x) => x.name !== c.name))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Failed to remove "${c.name}"`)
    }
  }

  const columns: Column<Cluster>[] = [
    { key: 'name', header: 'Name', render: (c) => <Text fontSize="$3">{c.name}</Text> },
    { key: 'status', header: 'Status', width: 130, render: (c) => <StatusTag status={c.status} /> },
    { key: 'kind', header: 'Kind', width: 90, render: (c) => <KindTag kind={c.kind} /> },
    { key: 'region', header: 'Region', width: 90 },
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
    {
      key: 'action',
      header: '',
      width: 90,
      render: (c) => (
        <XStack gap="$2" justify="flex-end" flex={1}>
          <Button size="$2" icon={<Trash size={14} />} onPress={() => void onDelete(c)} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Clusters"
        subtitle="Shared Hanzo Cloud or your own DigitalOcean Kubernetes."
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
            empty="No clusters yet. Provision a DOKS cluster or attach an existing one below."
          />

          <XStack gap="$4" flexWrap="wrap">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={320}>
          <Text fontSize="$5" fontWeight="700">
            Provision DOKS cluster
          </Text>
          <FieldRow label="Name">
            <YStack gap="$1.5" flex={1}>
              <FieldText value={pName} onChange={setPName} placeholder="prod-cluster" />
              <Text fontSize="$2" color={pNameErr ? '$color12' : '$color10'}>
                {pNameErr ?? 'Lowercase letters, numbers and hyphens. 2–40 chars.'}
              </Text>
            </YStack>
          </FieldRow>
          <FieldRow label="Region">
            <FieldSelect value={pRegion} options={[...DOKS_REGIONS]} onChange={setPRegion} />
          </FieldRow>
          <FieldRow label="Node size">
            <FieldSelect value={pNodeSize} options={[...DOKS_NODE_SIZES]} onChange={setPNodeSize} />
          </FieldRow>
          <FieldRow label="Node count">
            <FieldText
              value={String(pCount)}
              onChange={(v) => setPCount(clampCount(v))}
              placeholder="3"
            />
          </FieldRow>
          <XStack>
            <Button
              theme="light"
              icon={<Plus size={16} />}
              disabled={provisioning || !pName || !!pNameErr}
              onPress={() => void onProvision()}
            >
              {provisioning ? 'Provisioning…' : 'Provision'}
            </Button>
          </XStack>
        </Card>

        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={320}>
          <Text fontSize="$5" fontWeight="700">
            Attach existing cluster
          </Text>
          <FieldRow label="Name">
            <YStack gap="$1.5" flex={1}>
              <FieldText value={aName} onChange={setAName} placeholder="my-cluster" />
              <Text fontSize="$2" color={aNameErr ? '$color12' : '$color10'}>
                {aNameErr ?? 'A label for this cluster in the console.'}
              </Text>
            </YStack>
          </FieldRow>
          <FieldRow label="Kubeconfig">
            <FieldTextArea value={aKubeconfig} onChange={setAKubeconfig} rows={8} />
          </FieldRow>
          <XStack>
            <Button
              theme="light"
              icon={<Link2 size={16} />}
              disabled={attaching || !aName || !!aNameErr || !aKubeconfig.trim()}
              onPress={() => void onAttach()}
            >
              {attaching ? 'Attaching…' : 'Attach'}
            </Button>
          </XStack>
        </Card>
          </XStack>
        </>
      )}
    </>
  )
}
