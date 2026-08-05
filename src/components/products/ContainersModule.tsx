'use client'

/**
 * Containers — the workload console for a cluster, over the Hanzo PaaS control
 * plane via the same-origin `/paas` proxy (admin-gated; service token injected
 * server-side). Tabs are REAL sub-routes (the registry `:tab` pattern, like
 * Models/GPUs): Workloads / Pods / Containers / Images / Namespaces / Events.
 *
 *  - Workloads reads the canonical apps inventory (`GET /v1/apps`), scoped to the
 *    picked cluster — real declared/running tag, drift, health.
 *  - Pods/Containers/Images/Namespaces/Events each list their platform resource
 *    kind through the shared, tolerant `PaasResourceTab` (honest states when a
 *    kind isn't served on this deployment yet).
 *  - The right rail is the picked cluster's detail (k8s version, region, nodes,
 *    PROVISIONED CPU/RAM from its node pools) + Quick Actions (real routes — Create
 *    Deployment → /pipelines, View Logs). Nothing is fabricated.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, ScrollText, Plus } from '@hanzogui/lucide-icons-2'

import { PlatformApi, clustersFromApps, type Cluster, type PlatformApp } from '~/lib/api'
import { clusterCapacity, fmtVcpu, fmtRam } from '~/lib/api/nodes'
import { HintButton } from '~/components/ui/Metric'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'
import { WorkloadsTab } from './containers/WorkloadsTab'
import {
  PaasResourceTab,
  PODS_COLUMNS,
  CONTAINERS_COLUMNS,
  IMAGES_COLUMNS,
  NAMESPACES_COLUMNS,
  EVENTS_COLUMNS,
} from './containers/resource'
import { FieldSelect, PageHeader, StatusTag } from '@hanzo/ui/product'

function SidebarRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$2" color="$color11">{label}</Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>{value}</Text>
    </XStack>
  )
}

/** Right rail: the picked cluster's real detail + quick actions. */
function ClusterSidebar({
  name,
  doks,
  workloads,
  onLogs,
}: {
  name: string
  doks: Cluster | null
  workloads: number
  onLogs: () => void
}) {
  const cap = doks ? clusterCapacity(doks) : null
  return (
    <YStack width={300} minW={264} gap="$3">
      <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$5" fontWeight="700" numberOfLines={1}>{name || 'No cluster'}</Text>
        <Text fontSize="$2" color="$color10">{doks ? 'Dedicated Hanzo K8S' : 'Shared Hanzo Cloud / observed'}</Text>
        <YStack mt="$2">
          <SidebarRow label="Status" value={doks ? <StatusTag status={doks.phase || doks.status} /> : '—'} />
          <SidebarRow label="K8s version" value={doks?.k8sVersion || doks?.version || '—'} />
          <SidebarRow label="Region" value={doks?.region || '—'} />
          <SidebarRow label="Nodes" value={cap?.nodes ? String(cap.nodes) : '—'} />
          <SidebarRow label="CPU" value={cap ? fmtVcpu(cap.vcpu) : '—'} />
          <SidebarRow label="Memory" value={cap ? fmtRam(cap.ramGb) : '—'} />
          <SidebarRow label="Pods" value="—" />
          <SidebarRow label="Workloads" value={String(workloads)} />
        </YStack>
      </Card>

      <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$4" fontWeight="700">Quick actions</Text>
        <YStack gap="$2">
          <HintButton icon={<Plus size={15} />} onPress={() => { if (typeof window !== 'undefined') window.location.assign('/pipelines') }}>Create Deployment</HintButton>
          <HintButton icon={<ScrollText size={15} />} onPress={onLogs}>View Logs</HintButton>
        </YStack>
      </Card>
    </YStack>
  )
}

export function ContainersModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const search = useSearchParams() ?? new URLSearchParams()
  const tab = productSubpageSlug('containers', params.tab)

  const [apps, setApps] = useState<PlatformApp[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [cluster, setCluster] = useState<string>('')
  // Surface the apps-inventory failure honestly (a customer 403 → "Managed control
  // plane"), instead of masking it as a bare empty Workloads table.
  const [error, setError] = useState<PlatformError | null>(null)

  const load = useCallback(() => {
    PlatformApi.apps()
      .then((a) => {
        setApps(a)
        setError(null)
      })
      .catch((e) => {
        setApps([])
        setError(interpretPlatformError(e))
      })
    PlatformApi.listClusters().then(setClusters).catch(() => setClusters([]))
  }, [])

  useEffect(() => load(), [load])

  // Cluster options: every cluster that appears in the inventory (real). Seed the
  // selection from the ?cluster= deep link (the Kubernetes page "Workloads" button).
  const options = useMemo(() => clustersFromApps(apps), [apps])
  useEffect(() => {
    const fromUrl = search.get('cluster') ?? ''
    setCluster((cur) => cur || (fromUrl && (options.includes(fromUrl) || options.length === 0) ? fromUrl : options[0] ?? ''))
  }, [options, search])

  const active = cluster || options[0] || ''
  const scopedApps = useMemo(() => apps.filter((a) => a.cluster === active), [apps, active])
  const doks = useMemo(() => clusters.find((c) => c.name === active) ?? null, [clusters, active])

  // Every tab keeps the selected cluster — SubNav renders the registry's nav, this
  // builds its hrefs.
  const go = (id: string): string => `/containers${id ? `/${id}` : ''}${active ? `?cluster=${encodeURIComponent(active)}` : ''}`

  return (
    <>
      <PageHeader
        title="Containers"
        subtitle="Workloads, pods, and images across your clusters."
        actions={<Button icon={<RefreshCw size={16} />} onPress={load}>Refresh</Button>}
      />

      <SubNav id="containers" href={go} />

      <XStack width={260} items="center" gap="$2">
        <Text fontSize="$2" color="$color11">Cluster</Text>
        <YStack flex={1}>
          <FieldSelect value={active} options={options.length ? options : ['—']} onChange={setCluster} />
        </YStack>
      </XStack>

      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={1} minW={320} gap="$2">
          {tab === '' ? (
            error ? (
              <PlatformStateCard error={error} onRetry={load} />
            ) : (
              <WorkloadsTab apps={scopedApps} />
            )
          ) : tab === 'pods' ? (
            <PaasResourceTab path="pods" arrayKeys={['pods']} columns={PODS_COLUMNS} empty="No pods reported for this deployment." hint="The platform pods endpoint lights up here once served." />
          ) : tab === 'containers' ? (
            <PaasResourceTab path="containers" arrayKeys={['containers']} columns={CONTAINERS_COLUMNS} empty="No containers reported." />
          ) : tab === 'images' ? (
            <PaasResourceTab path="images" arrayKeys={['images']} columns={IMAGES_COLUMNS} empty="No images reported." />
          ) : tab === 'namespaces' ? (
            <PaasResourceTab path="namespaces" arrayKeys={['namespaces']} columns={NAMESPACES_COLUMNS} empty="No namespaces reported." />
          ) : (
            <PaasResourceTab path="events" arrayKeys={['events']} columns={EVENTS_COLUMNS} empty="No recent events." />
          )}
        </YStack>

        <ClusterSidebar
          name={active}
          doks={doks}
          workloads={scopedApps.length}
          onLogs={() => router.push('/logs')}
        />
      </XStack>
    </>
  )
}
