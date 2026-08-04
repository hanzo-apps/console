'use client'

/**
 * Customer GPUs — a tenant's accelerator surface, now TABBED like the admin fleet view
 * (Overview · GPUs · Clusters · Pools · Pricing · Alerts · Settings) so every sub-tab is
 * a real, distinct destination instead of the same static catalog. It mirrors
 * `AdminGpus`'s pattern (the shared `GpuTabBar` + `GPU_TABS`, the active tab read from
 * `params.tab`) but every tab is CUSTOMER-scoped, per-org, over the user-bearer proxies —
 * NEVER the admin `/paas` fleet, never the "PAAS_SERVICE_TOKEN" message:
 *
 *  - Overview / GPUs → visor's REAL catalog (`GET /v1/gpus`) + the org's OWN GPU
 *    machines (`GET /v1/machines`, GPU-filtered) via the `/v1/vm` proxy.
 *  - Clusters → the org's OWN dedicated clusters (`PlatformApi.listClusters` ←
 *    user-bearer `/v1/clusters`), honest-empty if none. (Reuses `ClustersTab`.)
 *  - Pools → GPU node pools derived from those real clusters (honest-empty).
 *  - Pricing → the REAL per-accelerator price list from the same live visor catalog.
 *  - Alerts → real alerts derived from the org's OWN GPU machines' health (honest-empty).
 *  - Settings → honest per-org GPU settings + real counts.
 *
 * Honest by construction: an empty catalog / machine / cluster list is a real state, a
 * field the backend omits renders "—", and nothing is fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Cable, Cloud, Cpu, HardDrive, RefreshCw, Rocket, Server } from '@hanzogui/lucide-icons-2'

import {
  VisorApi,
  fmtHourly,
  fmtSpec,
  statusVerdict,
  DASH,
  type VisorGpuSize,
  type VisorMachine,
} from '~/lib/api/visor'
import { PlatformApi, type Cluster } from '~/lib/api'
import { gpuClustersOf } from '~/lib/api/compute'
import { onlineCount, avgGpuUtil, queueDepth, runningCount, utilSeries } from '~/lib/api/fleet'
import { useFleetLive } from './useFleetLive'
import { QueueTab } from './QueueTab'
import { Sparkline } from './charts'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { useDetailPane } from '~/components/DetailPane'
import { productColorHex } from '~/lib/products/colors'
import { LaunchDrawer } from '../machines/LaunchDrawer'
import { ConnectGpuDrawer } from './ConnectGpuDrawer'
import { ConnectedMachines } from './ConnectedMachines'
import { FundingNote } from '../machines/FundingNote'
import { interpretPlatformError } from '../platform/state'
import { GpuTabBar, gpuTabId } from './tabs'
import { ClustersTab } from './ClustersTab'
import { AlertsTab } from './AlertsTab'
import { CustomerPricingTab } from './CustomerPricingTab'
import { CustomerPoolsTab } from './CustomerPoolsTab'
import { CustomerSettingsTab } from './CustomerSettingsTab'
import {
  cheapestHourly,
  distinctModelCount,
  gpuAlertsFromMachines,
  launchableGpus,
  sortByHourly,
} from './customer-logic'
import type { Async, ComputeData } from './state'

const VERDICT_TONE = { ok: '$green10', warn: '$yellow10', down: '$red10', idle: '$color9' } as const

/** True if a machine is GPU-accelerated (visor sets `gpu`, or a `gpu-*` size slug). */
const isGpuMachine = (m: VisorMachine): boolean => !!m.gpu || (m.type ?? '').toLowerCase().startsWith('gpu-')

function StatCard({ label, value, sub, spark }: { label: string; value: string; sub?: string; spark?: number[] }) {
  return (
    <YStack flex={1} minW={160} p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1">
      <Text fontSize="$2" color="$color11" fontWeight="600">{label}</Text>
      <Text fontSize="$8" fontWeight="900" color="$color12" numberOfLines={1} className="mono">{value}</Text>
      {spark && spark.length > 1 ? <Sparkline points={spark} width={148} height={26} /> : null}
      {sub ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{sub}</Text> : null}
    </YStack>
  )
}

/** BYO vs Cloud provider badge — a machine that dialed in via `hanzo gpu connect`
 *  (provider="byo") vs one Hanzo Cloud provisioned (visor/DOKS). Monochrome pill. */
function ProviderBadge({ provider }: { provider?: string }) {
  const byo = (provider ?? '').toLowerCase() === 'byo'
  const Icon = byo ? HardDrive : Cloud
  return (
    <XStack items="center" gap="$1.5" px="$2" height={22} rounded="$10" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <Icon size={11} color="$color11" />
      <Text fontSize="$1" color="$color11" fontWeight="700">{byo ? 'BYO' : 'Cloud'}</Text>
    </XStack>
  )
}

// ── Shared column definitions (Overview previews + the full GPUs tab) ─────────

const catalogColumns: Column<VisorGpuSize>[] = [
  {
    key: 'model',
    header: 'GPU',
    render: (c) => (
      <XStack items="center" gap="$2" minW={0}>
        <Cpu size={15} color="$color10" />
        <YStack minW={0}>
          <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>
            {c.gpuCount && c.gpuCount > 1 ? `${c.gpuCount}× ` : ''}{c.model || c.slug}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{c.slug}</Text>
        </YStack>
      </XStack>
    ),
  },
  { key: 'vram', header: 'VRAM', width: 90, render: (c) => <Text fontSize="$3" color="$color11">{c.vramGb != null ? `${c.vramGb} GB` : DASH}</Text> },
  {
    key: 'host',
    header: 'Host',
    width: 150,
    render: (c) => (
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {c.vcpus != null ? `${c.vcpus} vCPU` : DASH}{c.memGb != null ? ` · ${c.memGb} GB` : ''}
      </Text>
    ),
  },
  { key: 'hr', header: '$/hr', width: 84, render: (c) => <Text fontSize="$3" color="$color12" fontWeight="600">{fmtHourly(c.priceHourly)}</Text> },
  { key: 'mo', header: '$/mo', width: 96, render: (c) => <Text fontSize="$3" color="$color11">{c.priceMonthly != null ? `$${Math.round(c.priceMonthly).toLocaleString()}/mo` : DASH}</Text> },
]

const machineColumns: Column<VisorMachine>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (m) => (
      <YStack minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{m.name || m.id}</Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>{m.type || DASH}</Text>
      </YStack>
    ),
  },
  { key: 'gpu', header: 'GPU', width: 120, render: (m) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{m.gpu || DASH}</Text> },
  { key: 'source', header: 'Source', width: 92, render: (m) => <ProviderBadge provider={m.provider} /> },
  { key: 'region', header: 'Region', width: 100, render: (m) => <Text fontSize="$3" color="$color11">{m.region || DASH}</Text> },
  { key: 'spec', header: 'Resources', width: 140, render: (m) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtSpec(m)}</Text> },
  {
    key: 'status',
    header: 'Status',
    width: 110,
    render: (m) => (
      <XStack items="center" gap="$1.5">
        <YStack width={8} height={8} rounded="$10" bg={VERDICT_TONE[statusVerdict(m.status)]} />
        <Text fontSize="$2" color="$color11" numberOfLines={1}>{m.status || DASH}</Text>
      </XStack>
    ),
  },
  { key: 'cost', header: 'Cost', width: 92, render: (m) => <Text fontSize="$3" color="$color12">{fmtHourly(m.costHourlyUsd)}</Text> },
]

// ── Customer data (all per-org, over the user-bearer proxies) ─────────────────

type CustomerGpuData = {
  catalog: VisorGpuSize[]
  /** Cloud-provisioned GPU VMs (BYO boxes excluded — they are the connect fleet, loaded
   *  live by `useFleetLive` alongside the queue + board util). */
  machines: VisorMachine[]
  clusters: Async<Cluster[]>
  /** Catalog still loading (gates the catalog-derived tabs). */
  loading: boolean
  reload: () => void
}

/** Load every CUSTOMER-scoped GPU source: the visor catalog, the org's cloud GPU
 *  machines (`/v1/machines`), the BYO connect fleet (`/v1/fleet/workers`), and the
 *  org's own clusters (`/v1/clusters`). All independent so a slow/denied source never
 *  blocks another; the catalog gates first render. */
function useCustomerGpuData(): CustomerGpuData {
  const [catalog, setCatalog] = useState<VisorGpuSize[]>([])
  const [machines, setMachines] = useState<VisorMachine[]>([])
  const [clusters, setClusters] = useState<Async<Cluster[]>>({ phase: 'loading' })
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    setClusters({ phase: 'loading' })
    VisorApi.gpus().then(setCatalog).catch(() => setCatalog([])).finally(() => setLoading(false))
    // Cloud GPU VMs only — the BYO boxes are the connect fleet (shown ONCE below, with
    // live heartbeat + queue, from useFleetLive), so they are excluded here to avoid a
    // double-listing of the same machine.
    VisorApi.machines()
      .then((m) => setMachines(m.filter((x) => isGpuMachine(x) && (x.provider ?? '').toLowerCase() !== 'byo')))
      .catch(() => setMachines([]))
    PlatformApi.listClusters()
      .then((data) => setClusters({ phase: 'ready', data }))
      .catch((e) => setClusters({ phase: 'error', error: interpretPlatformError(e) }))
  }, [])

  useEffect(() => reload(), [reload])

  return { catalog, machines, clusters, loading, reload }
}

// ── Module ────────────────────────────────────────────────────────────────────

export function CustomerGpus({ params }: { params?: Record<string, string> }) {
  const tab = gpuTabId(params?.tab)
  const detail = useDetailPane()
  const { catalog, machines, clusters, loading, reload } = useCustomerGpuData()
  // Only poll the live fleet on the tabs that actually show it (Overview cards, the GPUs
  // tab's connected-machines table, and the Queue) — never on Clusters/Pools/Pricing/etc.
  const live = useFleetLive(tab === '' || tab === 'gpus' || tab === 'queue')

  const workerList = live.workers.phase === 'ready' ? live.workers.data : []
  const jobList = live.jobs.phase === 'ready' ? live.jobs.data : []
  const connectedCount = workerList.length
  const onlineConnected = onlineCount(workerList)
  const runningNow = runningCount(jobList)
  const queuedNow = queueDepth(jobList)
  const avgUtil = avgGpuUtil(live.units)
  const utilPoints = utilSeries(live.samples)
  const reloadAll = useCallback(() => {
    reload()
    live.reload()
  }, [reload, live.reload])

  const available = useMemo(() => launchableGpus(catalog), [catalog])
  const models = useMemo(() => distinctModelCount(available), [available])
  const cheapest = useMemo(() => cheapestHourly(available), [available])
  const alerts = useMemo(() => gpuAlertsFromMachines(machines), [machines])
  const gpuClusters = useMemo(() => (clusters.phase === 'ready' ? gpuClustersOf(clusters.data) : []), [clusters])

  // Adapter so the shared admin tabs (ClustersTab reads `clusters`; AlertsTab reads
  // `alerts`) render over CUSTOMER-safe data. `gpus`/`ledger`/`accountUsage` are not
  // read by either tab (only `clusters`, `alerts`, `reload`) — kept honest, not shown.
  const computeData: ComputeData = useMemo(
    () => ({
      gpus: { phase: 'ready', data: [] },
      clusters,
      alerts: { phase: 'ready', data: alerts },
      ledger: { phase: 'loading' },
      accountUsage: { phase: 'loading' },
      reload,
    }),
    [clusters, alerts, reload],
  )

  // The REAL launch flow — the shared drawer (kind=gpu). On success, reload so the new
  // GPU machine appears under "Your GPU machines". `initialSize` preselects the
  // accelerator a customer tapped in the catalog/pricing tables (tap-to-launch); the
  // header/empty-state "Launch a GPU" opens it with no preselection.
  const launch = useCallback(
    (initialSize?: string) =>
      detail.open({
        title: initialSize ? 'Launch this GPU' : 'Launch a GPU',
        subtitle: initialSize ? `${initialSize} · pick a region and go` : 'Pick an accelerator and region',
        icon: Rocket,
        iconColor: productColorHex('gpus'),
        size: 520,
        content: (
          <LaunchDrawer
            kind="gpu"
            initialSize={initialSize}
            onClose={detail.close}
            onLaunched={() => {
              detail.close()
              reload()
            }}
          />
        ),
      }),
    [detail, reload],
  )

  /** Tap a catalog/pricing row → launch that exact accelerator (its size slug). */
  const launchGpu = useCallback((c: VisorGpuSize) => launch(c.slug), [launch])

  // The BYO path — bring hardware you already own into the fleet via `hanzo gpu
  // connect` (or the Desktop toggle). Sibling of Deploy: connect your own OR spin up
  // cloud, both from here.
  const connect = useCallback(
    () =>
      detail.open({
        title: 'Connect your GPU',
        subtitle: 'Bring your own hardware to your fleet',
        icon: Cable,
        iconColor: productColorHex('gpus'),
        size: 520,
        content: <ConnectGpuDrawer onClose={detail.close} />,
        footer: <Button theme="light" onPress={detail.close}>Done</Button>,
      }),
    [detail],
  )

  const header = (
    <PageHeader
      title="GPUs"
      subtitle="Bring your own GPU or deploy one in the cloud — H100, A100, L40S, GB10 and more."
      actions={
        <XStack gap="$2">
          <Button size="$3" chromeless icon={<RefreshCw size={15} />} onPress={reloadAll} aria-label="Refresh" />
          <Button size="$3" borderWidth={1} borderColor="$borderColor" icon={<Cable size={15} />} onPress={connect}>Connect GPU</Button>
          <Button size="$3" theme="light" icon={<Rocket size={15} />} onPress={() => launch()}>Deploy GPU</Button>
        </XStack>
      }
    />
  )

  /** Spinner while the visor catalog resolves — gates the catalog-derived tabs only. */
  const catalogGate = (node: React.ReactNode): React.ReactNode =>
    loading ? <XStack p="$6" justify="center"><Spinner size="large" color="$color11" /></XStack> : node

  return (
    <>
      {header}
      <GpuTabBar active={tab} />

      {tab === '' ? catalogGate(renderOverview()) : null}
      {tab === 'gpus' ? catalogGate(renderGpus()) : null}
      {tab === 'queue' ? <QueueTab jobs={live.jobs} workers={workerList} onCancel={live.cancel} isCanceling={live.isCanceling} updatedAt={live.updatedAt} stale={live.stale} reload={live.reload} /> : null}
      {tab === 'clusters' ? <ClustersTab data={computeData} /> : null}
      {tab === 'pools' ? <CustomerPoolsTab clusters={clusters} /> : null}
      {tab === 'pricing' ? catalogGate(<CustomerPricingTab catalog={catalog} onLaunch={launchGpu} />) : null}
      {tab === 'alerts' ? <AlertsTab data={computeData} /> : null}
      {tab === 'settings' ? (
        <CustomerSettingsTab
          accelerators={available.length}
          machines={machines.length + connectedCount}
          clusters={clusters.phase === 'ready' ? clusters.data.length : 0}
          onLaunch={() => launch()}
        />
      ) : null}
    </>
  )

  // ── Tab bodies (plain functions; no inputs to remount, so no focus hazard) ───

  function renderOverview() {
    const topGpus = sortByHourly(available).slice(0, 5)
    return (
      <YStack gap="$4">
        {/* Funding — GPUs are prepay-only, charged to the card (24h minimum), NEVER
            the credit balance that funds CPU machines. Makes the distinction explicit. */}
        <FundingNote kind="gpu" />

        <XStack flexWrap="wrap" gap="$3" items="stretch">
          <StatCard label="Connected machines" value={String(connectedCount)} sub={connectedCount ? `${onlineConnected} online · hanzo gpu connect` : 'hanzo gpu connect'} />
          <StatCard label="Running now" value={String(runningNow)} sub={runningNow ? 'jobs in flight' : 'nothing running'} />
          <StatCard label="Queued jobs" value={String(queuedNow)} sub={queuedNow ? 'waiting for a GPU' : 'none waiting'} />
          <StatCard label="Avg GPU util" value={avgUtil != null ? `${avgUtil}%` : DASH} sub="live · fleet board" spark={utilPoints} />
          <StatCard
            label="Accelerators"
            value={String(available.length)}
            sub={models ? `${models} GPU model${models === 1 ? '' : 's'} · available to launch` : 'available to launch'}
          />
          <StatCard label="Cloud GPU machines" value={String(machines.length)} sub={machines.length ? 'running' : 'none yet'} />
          <StatCard label="GPU clusters" value={clusters.phase === 'ready' ? String(gpuClusters.length) : DASH} sub={gpuClusters.length ? 'dedicated' : 'shared Hanzo Cloud'} />
        </XStack>

        {/* The BYO connect fleet — your own hardware, with live heartbeat. */}
        <ConnectedMachines workers={live.workers} jobs={live.jobs} units={live.units} reload={live.reload} onConnect={connect} onCancel={live.cancel} isCanceling={live.isCanceling} updatedAt={live.updatedAt} stale={live.stale} />

        {/* Cloud-provisioned GPU VMs (shown when any; the deploy path is the header +
            the live catalog below, so no redundant empty card here). */}
        {machines.length ? (
          <YStack gap="$2">
            <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
              <Text fontSize="$4" fontWeight="800" color="$color12">Cloud GPU machines</Text>
              <Text fontSize="$1" color="$color10">{machines.length} running · full list in GPUs</Text>
            </XStack>
            <DataTable columns={machineColumns} rows={machines.slice(0, 5)} rowKey={(m) => m.id} empty="No cloud GPU machines yet." />
          </YStack>
        ) : null}

        <YStack gap="$2">
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
            <Text fontSize="$4" fontWeight="800" color="$color12">Popular accelerators</Text>
            <Text fontSize="$1" color="$color10">live catalog · visor · tap to launch</Text>
          </XStack>
          {topGpus.length ? (
            <DataTable columns={catalogColumns} rows={topGpus} rowKey={(c) => c.slug} onRowPress={launchGpu} empty="No GPU sizes available." />
          ) : (
            <Text fontSize="$2" color="$color10">The accelerator catalog isn’t reachable right now — nothing is fabricated.</Text>
          )}
        </YStack>
      </YStack>
    )
  }

  function renderGpus() {
    return (
      <YStack gap="$4">
        <ConnectedMachines workers={live.workers} jobs={live.jobs} units={live.units} reload={live.reload} onConnect={connect} onCancel={live.cancel} isCanceling={live.isCanceling} updatedAt={live.updatedAt} stale={live.stale} />

        {machines.length ? (
          <YStack gap="$2">
            <Text fontSize="$4" fontWeight="800" color="$color12">Cloud GPU machines</Text>
            <DataTable columns={machineColumns} rows={machines} rowKey={(m) => m.id} empty="No cloud GPU machines yet." />
          </YStack>
        ) : null}

        <YStack gap="$2">
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
            <Text fontSize="$4" fontWeight="800" color="$color12">GPU catalog</Text>
            <Text fontSize="$1" color="$color10">live catalog · visor · tap to launch</Text>
          </XStack>
          {available.length ? (
            <DataTable columns={catalogColumns} rows={available} rowKey={(c) => c.slug} onRowPress={launchGpu} empty="No GPU sizes available." />
          ) : (
            <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$5" items="center" gap="$2">
              <Server size={20} />
              <Text fontSize="$3" fontWeight="700">GPU catalog unavailable</Text>
              <Text fontSize="$2" color="$color11" text="center" maxW={420}>
                The accelerator catalog isn’t reachable right now. GPU machines you launch will still appear above — nothing is fabricated.
              </Text>
            </Card>
          )}
          {available.length ? (
            <Text fontSize="$1" color="$color10">
              Prices are the live per-accelerator hourly rate; monthly is the 730-hour equivalent. Tap any row to launch that accelerator.
            </Text>
          ) : null}
        </YStack>
      </YStack>
    )
  }
}
