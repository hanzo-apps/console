'use client'

/**
 * GPUs — Hanzo Cloud's GPU compute surface (a Lambda/CoreWeave-class console for
 * accelerator inventory, clusters, pools, utilization, alerts, and cost).
 *
 * Hanzo Cloud compute is a metered RESALE layer over DigitalOcean (primary GPU
 * Droplets + Paperspace) and AWS (secondary GPU instances). The `compute-provider`
 * connector is not live yet, so this is the UX shell that goes live now and lights up
 * when that connector lands. EVERY metric/row is a REAL backend call or an honest
 * empty/not-configured/error state — it never ships invented GPUs, clusters, or spend.
 *
 * Real sources (loaded once here, shared to the tabs): the GPU inventory
 * (`GET /paas/gpus`), the org's DOKS clusters (`GET /paas/org/{org}/cluster`, with GPU
 * clusters derived from the node size), GPU alerts (`GET /paas/gpus/alerts`), the cloud
 * usage ledger (`GET /v1/get-cloud-usages`, degrading to the real `/billing/usage`
 * total). All org-scoped to `currentOrg()`. Tabs map to the registry `:tab` route.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { XStack } from '@hanzo/gui'
import { KeyRound, Plus } from '@hanzogui/lucide-icons-2'

import { PlatformApi, type Cluster } from '~/lib/api'
import { BillingApi, type Usage } from '~/lib/api/billing'
import { ComputeApi, type Gpu, type GpuAlert, type UsageLedger } from '~/lib/api/compute'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { interpretPlatformError } from './platform/state'
import { livingOverviewModule } from './overview/living/LivingOverviewModule'
import { CustomerGpus } from './gpus/CustomerGpus'
import { QueueTab } from './gpus/QueueTab'
import { useFleetLive } from './gpus/useFleetLive'
import { GpuTabBar, gpuTabId } from './gpus/tabs'
import { HintButton } from './gpus/charts'
import { OverviewTab } from './gpus/OverviewTab'
import { GpusTab } from './gpus/GpusTab'
import { ClustersTab } from './gpus/ClustersTab'
import { PoolsTab } from './gpus/PoolsTab'
import { PricingTab } from './gpus/PricingTab'
import { AlertsTab } from './gpus/AlertsTab'
import { SettingsTab } from './gpus/SettingsTab'
import type { Async, ComputeData } from './gpus/state'
import { PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

/** Load every real source once; tabs read the typed state and stay presentational. */
function useComputeData(): ComputeData {
  const [gpus, setGpus] = useState<Async<Gpu[]>>({ phase: 'loading' })
  const [clusters, setClusters] = useState<Async<Cluster[]>>({ phase: 'loading' })
  const [alerts, setAlerts] = useState<Async<GpuAlert[]>>({ phase: 'loading' })
  const [ledger, setLedger] = useState<Async<UsageLedger, BackendState>>({ phase: 'loading' })
  const [accountUsage, setAccountUsage] = useState<Async<Usage, BackendState>>({ phase: 'loading' })

  const reload = useCallback(() => {
    setGpus({ phase: 'loading' })
    setClusters({ phase: 'loading' })
    setAlerts({ phase: 'loading' })
    setLedger({ phase: 'loading' })
    setAccountUsage({ phase: 'loading' })

    ComputeApi.gpus()
      .then((data) => setGpus({ phase: 'ready', data }))
      .catch((e) => setGpus({ phase: 'error', error: interpretPlatformError(e) }))
    PlatformApi.listClusters()
      .then((data) => setClusters({ phase: 'ready', data }))
      .catch((e) => setClusters({ phase: 'error', error: interpretPlatformError(e) }))
    ComputeApi.alerts()
      .then((data) => setAlerts({ phase: 'ready', data }))
      .catch((e) => setAlerts({ phase: 'error', error: interpretPlatformError(e) }))
    ComputeApi.usageLedger(7)
      .then((data) => setLedger({ phase: 'ready', data }))
      .catch((e) => setLedger({ phase: 'error', error: classifyBackend(e) }))
    BillingApi.usage()
      .then((data) => setAccountUsage({ phase: 'ready', data }))
      .catch((e) => setAccountUsage({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => reload(), [reload])

  return { gpus, clusters, alerts, ledger, accountUsage, reload }
}

/**
 * GPUs — routes by role. A CUSTOMER sees the visor accelerator catalog + their own
 * GPU machines (`CustomerGpus`, over the user-bearer `/v1/vm` proxy) — real per-org data
 * or an honest empty state, never the admin `/paas` fleet view. A GLOBAL ADMIN sees
 * the operator fleet (`AdminGpus`, over the `/paas` control plane), whose
 * not-configured/forbidden state is the right operator signal. One wrapper per route
 * (Overview + tabs), each branch a full component with its own hooks — no
 * rules-of-hooks hazard.
 */
export function GpusModule(props: { params: Record<string, string> }) {
  return useIsSuperAdmin() ? <AdminGpus {...props} /> : <CustomerGpus {...props} />
}

/** The GPUs Overview route (`/gpus`): the platform living overview for admins, the
 *  tabbed visor catalog for a customer. Kept here so the registry stays a plain data file. */
const GpusLiving = livingOverviewModule('gpus')
export function GpusOverview(props: { params: Record<string, string> }) {
  return useIsSuperAdmin() ? <GpusLiving {...props} /> : <CustomerGpus {...props} />
}

function AdminGpus({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const data = useComputeData()
  const tab = gpuTabId(params.tab)
  // The org's live gpu-jobs queue — only polled while the Queue tab is open.
  const live = useFleetLive(tab === 'queue')

  // Navigate to a GPU subtab (bare id) or an absolute console path (leading '/').
  const onNav = useCallback(
    (to: string) => router.push(to.startsWith('/') ? to : `/gpus${to ? `/${to}` : ''}`),
    [router],
  )

  return (
    <>
      <PageHeader
        title="GPUs"
        subtitle="Monitor and manage your GPU clusters, utilization, and costs."
        actions={
          <XStack gap="$2">
            <HintButton icon={<KeyRound size={15} />} onPress={() => onNav('/secrets')}>
              Connect a provider
            </HintButton>
            <HintButton icon={<Plus size={15} />} theme="light" onPress={() => onNav('clusters')}>
              Create cluster
            </HintButton>
          </XStack>
        }
      />

      <GpuTabBar active={tab} />

      {tab === '' ? (
        <OverviewTab data={data} onNav={onNav} />
      ) : tab === 'gpus' ? (
        <GpusTab data={data} onNav={onNav} />
      ) : tab === 'queue' ? (
        <QueueTab jobs={live.jobs} workers={live.workers.phase === 'ready' ? live.workers.data : []} onCancel={live.cancel} isCanceling={live.isCanceling} updatedAt={live.updatedAt} stale={live.stale} reload={live.reload} />
      ) : tab === 'clusters' ? (
        <ClustersTab data={data} />
      ) : tab === 'pools' ? (
        <PoolsTab />
      ) : tab === 'pricing' ? (
        <PricingTab onNav={onNav} />
      ) : tab === 'alerts' ? (
        <AlertsTab data={data} />
      ) : (
        <SettingsTab onNav={onNav} />
      )}
    </>
  )
}
