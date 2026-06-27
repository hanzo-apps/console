'use client'

/**
 * Kubernetes — browse workloads and operator-managed custom resources for one
 * cluster, through the Hanzo PaaS control plane (via the same-origin `/paas`
 * proxy, org-scoped by path). Pick a cluster, then tab across Deployments / Pods
 * / Services / Ingresses / Events / Custom Resources. Every state is honest:
 * loading, not-configured (501), backend-not-available (404), error, and empty
 * are all real — no fabricated rows, no fake charts.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Network } from '@hanzogui/lucide-icons-2'

import {
  PlatformApi,
  KubernetesApi,
  K8S_RESOURCES,
  type Cluster,
  type K8sResource,
  type K8sObject,
} from '~/lib/api'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { FieldSelect } from '~/components/ui/Field'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const DEFAULT_KIND: K8sResource = 'deployments'
const isKind = (v: string): v is K8sResource => K8S_RESOURCES.some((r) => r.id === v)

const fmtAge = (o: K8sObject): string => {
  if (o.age) return String(o.age)
  if (!o.createdAt) return '—'
  const d = new Date(o.createdAt)
  return Number.isNaN(d.getTime()) ? String(o.createdAt) : d.toLocaleString()
}

const txt = (v?: string | number | null) =>
  v === undefined || v === null || v === '' ? (
    <Text fontSize="$3" color="$color10">
      —
    </Text>
  ) : (
    <Text fontSize="$3" color="$color11" numberOfLines={1}>
      {String(v)}
    </Text>
  )

const nameCell = (o: K8sObject) => (
  <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
    {o.name ?? o.object ?? '—'}
  </Text>
)

/** Defensive, per-kind columns — render what the platform reports, nothing more. */
function columnsFor(kind: K8sResource): Column<K8sObject>[] {
  const ns: Column<K8sObject> = { key: 'namespace', header: 'Namespace', width: 160, render: (o) => txt(o.namespace) }
  const age: Column<K8sObject> = { key: 'age', header: 'Age', width: 180, render: (o) => txt(fmtAge(o)) }
  const status: Column<K8sObject> = {
    key: 'status',
    header: 'Status',
    width: 130,
    render: (o) => <StatusTag status={o.status ?? o.phase} />,
  }
  switch (kind) {
    case 'pods':
      return [{ key: 'name', header: 'Name', render: nameCell }, ns, status, { key: 'ready', header: 'Ready', width: 90, render: (o) => txt(o.ready) }, age]
    case 'services':
      return [{ key: 'name', header: 'Name', render: nameCell }, ns, { key: 'type', header: 'Type', width: 130, render: (o) => txt(o.type) }, age]
    case 'ingresses':
      return [{ key: 'name', header: 'Name', render: nameCell }, ns, { key: 'hosts', header: 'Hosts', render: (o) => txt(o.hosts?.join(', ') ?? o.host) }, age]
    case 'events':
      return [
        { key: 'type', header: 'Type', width: 110, render: (o) => txt(o.type) },
        { key: 'reason', header: 'Reason', width: 160, render: (o) => txt(o.reason) },
        { key: 'object', header: 'Object', render: (o) => txt(o.object ?? o.name) },
        { key: 'message', header: 'Message', render: (o) => txt(o.message) },
        age,
      ]
    case 'crs':
      return [{ key: 'name', header: 'Name', render: nameCell }, ns, { key: 'kind', header: 'Kind', width: 180, render: (o) => txt(o.kind) }, age]
    case 'deployments':
    default:
      return [{ key: 'name', header: 'Name', render: nameCell }, ns, { key: 'ready', header: 'Ready', width: 90, render: (o) => txt(o.ready) }, status, age]
  }
}

const rowKey = (o: K8sObject): string =>
  [o.namespace ?? '-', o.kind ?? '', o.name ?? o.object ?? '', o.reason ?? '', o.message ?? ''].join('|')

type ResourceState =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; rows: K8sObject[] }

/** The workload table for one (cluster, kind) — honest states then DataTable. */
function ResourcePanel({ org, cluster, kind }: { org: string; cluster: string; kind: K8sResource }) {
  const [state, setState] = useState<ResourceState>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    KubernetesApi.listResource(org, cluster, kind)
      .then((rows) => setState({ phase: 'ready', rows }))
      .catch((e) => setState({ phase: 'error', error: interpretPlatformError(e) }))
  }, [org, cluster, kind])

  useEffect(() => {
    load()
  }, [load])

  if (state.phase === 'error') return <PlatformStateCard error={state.error} onRetry={load} />

  return (
    <DataTable
      columns={columnsFor(kind)}
      rows={state.phase === 'ready' ? state.rows : []}
      loading={state.phase === 'loading'}
      rowKey={rowKey}
      empty={`No ${kind} in this cluster.`}
    />
  )
}

type ClustersState =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; clusters: Cluster[] }

const clusterId = (c: Cluster): string => c.id ?? c.name

export function KubernetesModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const org = config.iamOrgName
  const kind: K8sResource = params.tab && isKind(params.tab) ? params.tab : DEFAULT_KIND

  const [clusters, setClusters] = useState<ClustersState>({ phase: 'loading' })
  const [selected, setSelected] = useState<Cluster | null>(null)

  const loadClusters = useCallback(() => {
    setClusters({ phase: 'loading' })
    PlatformApi.listClusters()
      .then((list) => {
        const arr = list ?? []
        setClusters({ phase: 'ready', clusters: arr })
        setSelected((cur) => cur ?? arr[0] ?? null)
      })
      .catch((e) => setClusters({ phase: 'error', error: interpretPlatformError(e) }))
  }, [])

  useEffect(() => {
    loadClusters()
  }, [loadClusters])

  return (
    <>
      <PageHeader
        title="Kubernetes"
        subtitle="Workloads and operator custom resources across your clusters."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={loadClusters}>
            Refresh
          </Button>
        }
      />

      {clusters.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading clusters…</Text>
        </XStack>
      ) : clusters.phase === 'error' ? (
        <PlatformStateCard error={clusters.error} onRetry={loadClusters} />
      ) : clusters.clusters.length === 0 ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
          <XStack gap="$2" items="center">
            <Network size={18} />
            <Text fontSize="$5" fontWeight="700">
              No clusters yet
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            Provision a DOKS cluster or attach an existing one, then browse its workloads here.
          </Text>
          <Button size="$2" self="flex-start" onPress={() => router.push('/clusters')}>
            Go to Clusters
          </Button>
        </Card>
      ) : (
        <>
          <XStack gap="$3" items="center" flexWrap="wrap">
            <Text fontSize="$3" color="$color11" fontWeight="600">
              Cluster
            </Text>
            <YStack minW={240}>
              <FieldSelect
                value={selected ? selected.name : clusters.clusters[0].name}
                options={clusters.clusters.map((c) => c.name)}
                onChange={(name) =>
                  setSelected(clusters.clusters.find((c) => c.name === name) ?? clusters.clusters[0])
                }
              />
            </YStack>
          </XStack>

          <XStack gap="$1" flexWrap="wrap">
            {K8S_RESOURCES.map((r) => (
              <Button
                key={r.id}
                size="$2"
                bg={r.id === kind ? '$color5' : 'transparent'}
                borderWidth={1}
                borderColor="$borderColor"
                onPress={() => router.push(r.id === DEFAULT_KIND ? '/kubernetes' : `/kubernetes/${r.id}`)}
              >
                {r.label}
              </Button>
            ))}
          </XStack>

          <ResourcePanel
            org={org}
            cluster={clusterId(selected ?? clusters.clusters[0])}
            kind={kind}
          />
        </>
      )}
    </>
  )
}
