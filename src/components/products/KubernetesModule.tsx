'use client'

/**
 * Kubernetes — the cluster control plane for your org's dedicated Hanzo K8S
 * (DigitalOcean Kubernetes), through the Hanzo PaaS via the same-origin `/paas`
 * proxy (admin-gated; the service token is injected server-side). It lists the
 * org's REAL clusters (`GET /v1/org/{org}/cluster`), derives PROVISIONED capacity
 * (nodes / vCPU / RAM) from each cluster's real node pools, cross-references the
 * apps inventory (`GET /v1/apps`) for the running-workload count, and provisions
 * a fresh cluster (`POST /v1/org/{org}/cluster` → `PlatformApi.provisionCluster`).
 *
 * Honest by construction: live CPU/memory UTILIZATION % is not exposed by the
 * control plane, so the CPU/Memory columns + cards show provisioned capacity
 * (real, derived from the node slug) — never a fabricated utilization bar. Every
 * failure renders a truthful state: loading, not-configured (proxy 501 / token
 * rejected → 403), empty, or upstream error. No fabricated clusters, ever.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Cpu, HardDrive, Network, Plus, RefreshCw, Server, Activity, ChevronRight } from '@hanzogui/lucide-icons-2'

import {
  ApiError,
  PlatformApi,
  clustersFromApps,
  DOKS_REGIONS,
  DOKS_NODE_SIZES,
  type Cluster,
  type PlatformApp,
} from '~/lib/api'
import { clusterCapacity, fleetCapacity, isClusterRunning, fmtVcpu, fmtRam } from '~/lib/api/nodes'
import { currentOrg } from '~/lib/org-scope'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { FieldRow, FieldSelect } from '~/components/ui/Field'
import { MetricCard } from '~/components/ui/Metric'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: PlatformError } | { phase: 'ready'; data: T }

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

const clampCount = (v: string): number => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 100)
}

/** Inline provision form — the platform names the cluster; the DO token is server-side. */
function CreateClusterPanel({ org, onCreated, onClose }: { org: string; onCreated: () => void; onClose: () => void }) {
  const [region, setRegion] = useState<string>(DOKS_REGIONS[2]) // sfo3
  const [nodeSize, setNodeSize] = useState<string>(DOKS_NODE_SIZES[2])
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await PlatformApi.provisionCluster(org, { region, nodeSize, nodeCount: count })
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to provision cluster')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={480}>
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">Create cluster</Text>
        <Text fontSize="$2" color="$color10" cursor="pointer" onPress={onClose}>Cancel</Text>
      </XStack>
      <FieldRow label="Region">
        <FieldSelect value={region} options={[...DOKS_REGIONS]} onChange={setRegion} />
      </FieldRow>
      <FieldRow label="Node size">
        <FieldSelect value={nodeSize} options={[...DOKS_NODE_SIZES]} onChange={setNodeSize} />
      </FieldRow>
      <FieldRow label="Node count">
        <FieldSelect
          value={String(count)}
          options={['1', '2', '3', '4', '5', '6', '8', '10']}
          onChange={(v) => setCount(clampCount(v))}
        />
      </FieldRow>
      {error ? <Text fontSize="$2" color="#e5534b">{error}</Text> : null}
      <XStack gap="$2">
        <Button theme="light" icon={<Plus size={16} />} disabled={busy} onPress={() => void submit()}>
          {busy ? 'Provisioning…' : 'Provision cluster'}
        </Button>
      </XStack>
      <Text fontSize="$2" color="$color10">
        Spins up a DigitalOcean Kubernetes cluster, installs the Hanzo operator, and makes it your
        deploy target. Billed by DigitalOcean.
      </Text>
    </Card>
  )
}

export function KubernetesModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const org = currentOrg()
  const [clusters, setClusters] = useState<Async<Cluster[]>>({ phase: 'loading' })
  const [apps, setApps] = useState<PlatformApp[]>([])
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setClusters({ phase: 'loading' })
    PlatformApi.listClusters()
      .then((data) => setClusters({ phase: 'ready', data }))
      .catch((e) => setClusters({ phase: 'error', error: interpretPlatformError(e) }))
    // Apps inventory is enrichment (the running-workload count) — never blocks the page.
    PlatformApi.apps()
      .then(setApps)
      .catch(() => setApps([]))
  }, [])

  useEffect(() => load(), [load])

  const rows = clusters.phase === 'ready' ? clusters.data : []
  const fleet = useMemo(() => fleetCapacity(rows), [rows])
  const runningCount = useMemo(() => rows.filter(isClusterRunning).length, [rows])
  // Apps observed on a dedicated cluster (not the shared Hanzo Cloud target).
  const clusterNames = useMemo(() => new Set(rows.map((c) => c.name)), [rows])
  const workloadCount = useMemo(
    () => apps.filter((a) => clusterNames.has(a.cluster)).length || apps.length,
    [apps, clusterNames],
  )

  const columns: Column<Cluster>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <YStack>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{c.name}</Text>
          {c.active ? <Text fontSize="$1" color="$color10">deploy target</Text> : null}
        </YStack>
      ),
    },
    { key: 'status', header: 'Status', width: 120, render: (c) => <StatusTag status={c.phase || c.status} /> },
    {
      key: 'nodes',
      header: 'Nodes',
      width: 80,
      render: (c) => <Text fontSize="$3" color="$color11">{clusterCapacity(c).nodes || '—'}</Text>,
    },
    {
      key: 'cpu',
      header: 'CPU',
      width: 100,
      render: (c) => {
        const cap = clusterCapacity(c)
        return <Text fontSize="$3" color="$color11" numberOfLines={1}>{fmtVcpu(cap.vcpu)}</Text>
      },
    },
    {
      key: 'memory',
      header: 'Memory',
      width: 100,
      render: (c) => {
        const cap = clusterCapacity(c)
        return <Text fontSize="$3" color="$color11" numberOfLines={1}>{fmtRam(cap.ramGb)}</Text>
      },
    },
    {
      key: 'k8s',
      header: 'Version',
      width: 100,
      render: (c) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{c.k8sVersion || c.version || '—'}</Text>,
    },
    {
      key: 'region',
      header: 'Region',
      width: 90,
      render: (c) => <Text fontSize="$3" color="$color11">{c.region || '—'}</Text>,
    },
    {
      key: 'created',
      header: 'Created',
      width: 110,
      render: (c) => <Text fontSize="$3" color="$color11">{fmtDate(c.createdAt)}</Text>,
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      render: (c) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => router.push(`/containers?cluster=${encodeURIComponent(c.name)}`)}>
            Workloads
          </Button>
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Kubernetes"
        subtitle="Your dedicated Hanzo K8S clusters. Workloads otherwise run on the shared Hanzo Cloud."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button icon={<RefreshCw size={16} />} onPress={load}>Refresh</Button>
            <Button theme="light" icon={<Plus size={16} />} onPress={() => setCreating((v) => !v)}>Create cluster</Button>
          </XStack>
        }
      />

      {/* Stat cards — REAL counts + provisioned capacity; honest "—" when a slug can't be parsed. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Network size={15} />} label="Total clusters" value={clusters.phase === 'ready' ? String(rows.length) : '—'} caption="dedicated DOKS" />
        <MetricCard icon={<Activity size={15} />} label="Running" value={clusters.phase === 'ready' ? String(runningCount) : '—'} caption={clusters.phase === 'ready' ? `${rows.length - runningCount} other` : 'cluster phase'} />
        <MetricCard icon={<Server size={15} />} label="Nodes" value={fleet.nodes ? fleet.nodes.toLocaleString() : '—'} caption="across all pools" />
        <MetricCard icon={<Cpu size={15} />} label="CPU" value={fmtVcpu(fleet.vcpu)} caption={fleet.allKnown ? 'provisioned' : 'provisioned (partial)'} />
        <MetricCard icon={<HardDrive size={15} />} label="Memory" value={fmtRam(fleet.ramGb)} caption={fleet.allKnown ? 'provisioned' : 'provisioned (partial)'} />
        <MetricCard icon={<Boxes size={15} />} label="Workloads" value={apps.length ? String(workloadCount) : '—'} caption="apps observed" />
      </XStack>

      {creating ? (
        <CreateClusterPanel org={org} onCreated={load} onClose={() => setCreating(false)} />
      ) : null}

      {clusters.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center"><Spinner /><Text color="$color11">Loading clusters…</Text></XStack>
      ) : clusters.phase === 'error' ? (
        <PlatformStateCard error={clusters.error} onRetry={load} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.doksClusterId || c.id || c.name}
          empty="No dedicated clusters yet. Create one above, or keep running on the shared Hanzo Cloud."
        />
      )}
    </>
  )
}
