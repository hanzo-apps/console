'use client'

/**
 * admin.<brand> INFRASTRUCTURE — the DigitalOcean fleet cockpit: droplets, block-storage
 * volumes, DOKS clusters and load balancers, what each costs per month, and what can be
 * reclaimed. GLOBAL-ADMIN ONLY (`admin: true` hides it from every customer; the
 * `/v1/admin/infra` aggregate is server-gated by `getAdminGate`).
 *
 * Six tabs over ONE snapshot read (`GET /v1/admin/infra`, `?refresh=1` busts the 60s
 * cache): Overview · Clusters · Nodes · Volumes · Load balancers · Audit.
 *
 * Two honesty rules this board exists to enforce:
 *  1. Droplet LOCAL disk is INCLUDED in the droplet price. It is NOT block storage and
 *     NOT separately billed. The Overview says so loudly, because operators otherwise
 *     chase a phantom line item that does not exist.
 *  2. A delete affordance appears if and ONLY if the backend says `deletable` (which
 *     means a COMPLETE scan proved the volume unreferenced). Otherwise the row shows
 *     `blockedReason` instead — never a delete the server will refuse.
 *
 * Every table sorts on every column through the shared `DataTable` sort props + the pure
 * `sortRows` comparator; nothing here re-implements ordering, filtering, or formatting.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Ban, CircleAlert, HardDrive, Layers, Network, RefreshCw, Server, ShieldAlert, Trash2 } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  AdminInfraApi,
  type InfraCluster,
  type InfraFinding,
  type InfraLoadBalancer,
  type InfraNode,
  type InfraSnapshot,
  type InfraVolume,
} from '~/lib/api/admin-infra'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard, Panel } from '~/components/ui/Metric'
import { DataTable, type Column, type SortState } from '~/components/ui/DataTable'
import { Segmented, SearchInput, type Option } from '~/components/ui/Filters'
import { SlideOver } from '~/components/ui/SlideOver'
import { ConfirmDelete } from '~/components/ui/ConfirmDelete'
import { BackendStateCard, classifyBackend } from '~/components/ui/BackendState'
import { StatusTag } from '~/components/ui/StatusTag'
import { EmptyState } from '~/components/ui/EmptyState'
import { FieldSwitch } from '~/components/ui/Field'
import { useToast } from '~/components/ui/Toast'
import { asApiError, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import { fmtAgo, fmtBytes } from '~/components/products/observability/apm-format'
import { StorageFleetApi, type StorageVolume } from '~/lib/api/storage-fleet'
import {
  canDelete,
  deleteMessage,
  distinctValues,
  drainMessage,
  filterByStatus,
  filterFindings,
  filterNodes,
  filterVolumes,
  gib,
  groupFindings,
  nextSort,
  severityTone,
  sortRows,
  usd,
  volumeStateTone,
  type FindingFilter,
  type NodeFilter,
  type Sort,
  type VolumeFilter,
} from './logic'

/** The board's tabs, in display order. `id` matches the registry sub-page slug. */
const TABS: { id: string; label: string }[] = [
  { id: '', label: 'Overview' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'volumes', label: 'Volumes' },
  { id: 'load-balancers', label: 'Load balancers' },
  { id: 'audit', label: 'Audit' },
]

const EMPTY: InfraSnapshot = {
  at: '',
  complete: true,
  incompleteReason: '',
  sources: [],
  totals: {
    clusters: 0, nodes: 0, volumes: 0, loadBalancers: 0, volumeGiB: 0, attachedVolumes: 0, attachedGiB: 0,
    detachedVolumes: 0, detachedGiB: 0, unreferencedVolumes: 0, unreferencedGiB: 0, idlePVCs: 0, localDiskGiB: 0,
  },
  cost: { dropletsMonthly: 0, volumesMonthly: 0, loadBalancersMonthly: 0, totalMonthly: 0, reclaimableMonthly: 0 },
  clusters: [], nodes: [], volumes: [], loadBalancers: [], findings: [],
}

/** Header-click sorting for one table: state + the reducer, wired to `DataTable`. */
function useSort(key: string, dir: Sort['dir'] = 'asc') {
  const [sort, setSort] = useState<Sort>({ key, dir })
  const onSortChange = useCallback((k: string) => setSort((s) => nextSort(s, k)), [])
  const apply = useCallback(<T,>(rows: T[]): T[] => sortRows(rows, sort.key, sort.dir), [sort])
  return { sort: sort as SortState, onSortChange, apply }
}

/** The ONE filter bar: search + a segmented state control, wrapping on narrow screens. */
function FilterBar<T extends string>({ q, onQ, placeholder, options, value, onChange }: {
  q: string
  onQ: (v: string) => void
  placeholder: string
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <XStack gap="$2" items="center" flexWrap="wrap">
      <SearchInput value={q} onChange={onQ} placeholder={placeholder} />
      <Segmented options={options} value={value} onChange={onChange} />
    </XStack>
  )
}

/** One label/value row in a detail drawer. Absent values read as an honest em-dash. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <XStack justify="space-between" gap="$3" items="flex-start" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$2" color="$color10" minW={120}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text fontSize="$2" color="$color12" text="right" flex={1}>{value === '' ? '—' : value}</Text>
      ) : (value ?? <Text fontSize="$2" color="$color12">—</Text>)}
    </XStack>
  )
}

const ALL_OPT = <T extends string>(vals: string[]): Option<T>[] => [{ label: 'All', value: 'all' as T }, ...vals.map((v) => ({ label: v, value: v as T }))]

export function InfraModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const toast = useToast()
  const tab = useMemo(() => (TABS.some((t) => t.id === params.tab) ? params.tab ?? '' : ''), [params.tab])

  const [snap, setSnap] = useState<InfraSnapshot | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (refresh?: boolean) => {
    setLoading(true)
    try {
      setSnap(await AdminInfraApi.snapshot(refresh))
      setErr(null)
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const data = snap ?? EMPTY

  const body = (() => {
    if (err) return isForbidden(err) ? <OperatorAccessRequired /> : <BackendStateCard state={classifyBackend(err)} onRetry={() => void load()} hint="GET /v1/admin/infra" />
    if (tab === 'clusters') return <ClustersTab data={data} loading={loading} />
    if (tab === 'nodes') return <NodesTab data={data} loading={loading} reload={() => void load(true)} toast={toast} />
    if (tab === 'volumes') return <VolumesTab data={data} loading={loading} reload={() => void load(true)} toast={toast} />
    if (tab === 'load-balancers') return <LoadBalancersTab data={data} loading={loading} />
    if (tab === 'audit') return <AuditTab data={data} loading={loading} />
    return <OverviewTab data={data} loading={loading} />
  })()

  return (
    <>
      <PageHeader
        title="Infrastructure"
        subtitle={`DigitalOcean fleet — droplets, block-storage volumes, clusters and load balancers.${data.at ? ` Scanned ${fmtAgo(data.at)}.` : ''}`}
        actions={
          <Button size="$2" icon={<RefreshCw size={14} />} disabled={loading} onPress={() => void load(true)}>
            {loading ? 'Scanning…' : 'Rescan'}
          </Button>
        }
      />

      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id || 'overview'}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.id ? `/infra/${t.id}` : '/infra')}
          >
            {t.label}
          </Button>
        ))}
      </XStack>

      {!err && !data.complete ? <ScanBanner data={data} /> : null}
      {body}
    </>
  )
}

/** The scan-completeness banner — an incomplete scan makes NOTHING deletable. */
function ScanBanner({ data }: { data: InfraSnapshot }) {
  const failed = data.sources.filter((s) => !s.ok)
  return (
    <Card borderWidth={1} borderColor="$yellow8" bg="$yellow2" p="$3.5" gap="$2">
      <XStack gap="$2" items="center">
        <CircleAlert size={16} color="$yellow11" />
        <Text fontSize="$4" fontWeight="700" color="$color12">Scan incomplete — no volume can be deleted</Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {data.incompleteReason || 'At least one cluster could not be scanned.'} Until every cluster reports, a volume that
        looks unreferenced may still be in use by the cluster we could not read, so deletion is disabled fleet-wide.
      </Text>
      {failed.length ? (
        <Text fontSize="$2" color="$color10">
          Failed sources: {failed.map((s) => `${s.name} (${s.error || 'no error given'})`).join(' · ')}
        </Text>
      ) : null}
    </Card>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewTab({ data, loading }: { data: InfraSnapshot; loading: boolean }) {
  const { cost, totals } = data
  const dash = (s: string) => (loading && !data.at ? '—' : s)
  return (
    <YStack gap="$3">
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Layers size={15} />} label="Total monthly" value={dash(usd(cost.totalMonthly))} caption={`${totals.clusters} clusters · ${totals.nodes} nodes`} />
        <MetricCard icon={<Server size={15} />} label="Droplets" value={dash(usd(cost.dropletsMonthly))} caption={`${totals.nodes} droplets · local disk included`} />
        <MetricCard icon={<HardDrive size={15} />} label="Block storage" value={dash(usd(cost.volumesMonthly))} caption={`${totals.volumes} volumes · ${gib(totals.volumeGiB)}`} />
        <MetricCard icon={<Network size={15} />} label="Load balancers" value={dash(usd(cost.loadBalancersMonthly))} caption={`${totals.loadBalancers} load balancers`} />
        <MetricCard icon={<Trash2 size={15} />} label="Reclaimable" value={dash(usd(cost.reclaimableMonthly))} caption={`${totals.unreferencedVolumes} unreferenced · ${gib(totals.unreferencedGiB)}`} />
      </XStack>

      {/* The phantom-cost note. Deliberately loud: droplet-local disk is the single most
          common thing operators hunt for as a separate line item. It does not exist. */}
      <Card borderWidth={1} borderColor="$blue8" bg="$blue2" p="$4" gap="$2">
        <XStack gap="$2" items="center">
          <HardDrive size={16} color="$blue11" />
          <Text fontSize="$4" fontWeight="700" color="$color12">
            Droplet local disk is included in the droplet price — it is never billed separately
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          The fleet's {totals.nodes} droplets carry <Text fontWeight="700" color="$color12">{gib(totals.localDiskGiB)}</Text> of
          LOCAL disk. That storage is part of the {usd(cost.dropletsMonthly)}/mo droplet price — there is no separate
          line item for it, and reducing it does not reduce the bill.
        </Text>
        <Text fontSize="$3" color="$color11">
          The <Text fontWeight="700" color="$color12">Block storage</Text> figure ({usd(cost.volumesMonthly)}/mo
          for {totals.volumes} volumes, {gib(totals.volumeGiB)}) is the ONLY separately-billed storage, and it is what the
          Volumes tab manages. Do not add the two together — {gib(totals.localDiskGiB)} of local disk is already inside the
          droplet number above.
        </Text>
      </Card>

      <XStack gap="$3" flexWrap="wrap">
        <Panel title="Block storage by state">
          <YStack gap="$1">
            <Fact label="Attached" value={`${totals.attachedVolumes} · ${gib(totals.attachedGiB)}`} />
            <Fact label="Detached" value={`${totals.detachedVolumes} · ${gib(totals.detachedGiB)}`} />
            <Fact label="Unreferenced" value={`${totals.unreferencedVolumes} · ${gib(totals.unreferencedGiB)} · ${usd(data.cost.reclaimableMonthly)}/mo`} />
            <Fact label="Idle PVCs" value={String(totals.idlePVCs)} />
          </YStack>
        </Panel>
        <Panel title="Scan sources">
          {data.sources.length === 0 ? (
            <Text fontSize="$2" color="$color10">No sources reported.</Text>
          ) : (
            <YStack gap="$1">
              {data.sources.map((s) => (
                <Fact
                  key={s.name}
                  label={s.name}
                  value={<XStack gap="$2" items="center"><StatusTag status={s.ok ? 'ok' : 'failed'} /><Text fontSize="$2" color="$color10">{s.ok ? `${s.rows} rows` : s.error || 'failed'}</Text></XStack>}
                />
              ))}
            </YStack>
          )}
        </Panel>
      </XStack>
    </YStack>
  )
}

// ── Clusters ──────────────────────────────────────────────────────────────────

function ClustersTab({ data, loading }: { data: InfraSnapshot; loading: boolean }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState<InfraCluster | null>(null)
  const { sort, onSortChange, apply } = useSort('monthlyCents', 'desc')

  const options = useMemo(() => ALL_OPT<string>(distinctValues(data.clusters, (c) => c.status)), [data.clusters])
  const rows = useMemo(
    () => apply(filterByStatus(data.clusters, q, status, (c) => c.status, (c) => `${c.name} ${c.id} ${c.region} ${c.version} ${c.status}`)),
    [data.clusters, q, status, apply],
  )

  const columns: Column<InfraCluster>[] = [
    { key: 'name', header: 'Cluster', sortable: true, render: (c) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{c.name}</Text> },
    { key: 'region', header: 'Region', width: 90, sortable: true },
    { key: 'version', header: 'Version', width: 110, sortable: true },
    { key: 'status', header: 'Status', width: 110, sortable: true, render: (c) => <StatusTag status={c.status} /> },
    { key: 'nodePools', header: 'Pools', width: 70, align: 'right', mono: true, sortable: true },
    { key: 'nodes', header: 'Nodes', width: 70, align: 'right', mono: true, sortable: true },
    { key: 'pods', header: 'Pods', width: 70, align: 'right', mono: true, sortable: true },
    { key: 'pvs', header: 'PVs', width: 60, align: 'right', mono: true, sortable: true },
    { key: 'pvcs', header: 'PVCs', width: 66, align: 'right', mono: true, sortable: true },
    { key: 'idlePVCs', header: 'Idle PVCs', width: 84, align: 'right', mono: true, sortable: true },
    { key: 'scanned', header: 'Scanned', width: 90, sortable: true, render: (c) => <StatusTag status={c.scanned ? 'ok' : 'failed'} /> },
    { key: 'monthlyCents', header: 'Monthly', width: 100, align: 'right', mono: true, sortable: true, render: (c) => usd(c.monthlyCents) },
  ]

  return (
    <YStack gap="$3">
      <FilterBar q={q} onQ={setQ} placeholder="Search clusters…" options={options} value={status} onChange={setStatus} />
      <DataTable columns={columns} rows={rows} loading={loading} rowKey={(c) => c.id} onRowPress={setOpen} sort={sort} onSortChange={onSortChange} empty="No clusters." />
      <SlideOver open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} icon={Layers} size={460}>
        {open ? (
          <YStack gap="$1">
            <Fact label="Cluster ID" value={open.id} />
            <Fact label="Region" value={open.region} />
            <Fact label="Version" value={open.version} />
            <Fact label="Status" value={<StatusTag status={open.status} />} />
            <Fact label="Node pools" value={String(open.nodePools)} />
            <Fact label="Nodes" value={String(open.nodes)} />
            <Fact label="Pods" value={String(open.pods)} />
            <Fact label="PVs / PVCs" value={`${open.pvs} / ${open.pvcs}`} />
            <Fact label="Idle PVCs" value={String(open.idlePVCs)} />
            <Fact label="Monthly" value={`${usd(open.monthlyCents)}/mo`} />
            <Fact label="Scanned" value={open.scanned ? 'Yes' : `No — ${open.scanError || 'no error given'}`} />
          </YStack>
        ) : null}
      </SlideOver>
    </YStack>
  )
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

type Toast = ReturnType<typeof useToast>

const NODE_OPTIONS: Option<NodeFilter>[] = [
  { label: 'All', value: 'all' },
  { label: 'Ready', value: 'ready' },
  { label: 'Not ready', value: 'notready' },
  { label: 'Cordoned', value: 'cordoned' },
]

function NodesTab({ data, loading, reload, toast }: { data: InfraSnapshot; loading: boolean; reload: () => void; toast: Toast }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState<NodeFilter>('all')
  const [open, setOpen] = useState<InfraNode | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const { sort, onSortChange, apply } = useSort('monthlyCents', 'desc')

  const rows = useMemo(() => apply(filterNodes(data.nodes, q, state)), [data.nodes, q, state, apply])

  /** Cordon/uncordon in place — a real `POST …/cordon`, then rescan. */
  const cordon = useCallback(async (n: InfraNode, next: boolean) => {
    setBusy(n.id)
    try {
      const r = await AdminInfraApi.cordonNode(n.id, next, false)
      toast.success(next ? `Cordoned ${r.name || n.name}` : `Uncordoned ${r.name || n.name}`, next ? 'No new pods will schedule here.' : 'The node is schedulable again.')
      reload()
    } catch (e) {
      toast.error('Could not change scheduling', classifyBackend(e).message)
    } finally {
      setBusy(null)
    }
  }, [reload, toast])

  const columns: Column<InfraNode>[] = [
    { key: 'name', header: 'Node', sortable: true, render: (n) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{n.name}</Text> },
    { key: 'cluster', header: 'Cluster', width: 150, sortable: true },
    { key: 'region', header: 'Region', width: 80, sortable: true },
    { key: 'sizeSlug', header: 'Size', width: 130, sortable: true, mono: true },
    { key: 'vcpus', header: 'vCPU', width: 66, align: 'right', mono: true, sortable: true },
    { key: 'memoryMiB', header: 'Memory', width: 90, align: 'right', mono: true, sortable: true, render: (n) => fmtBytes(n.memoryMiB * 1024 * 1024) },
    { key: 'localDiskGiB', header: 'Local disk', width: 96, align: 'right', mono: true, sortable: true, render: (n) => gib(n.localDiskGiB) },
    { key: 'pods', header: 'Pods', width: 66, align: 'right', mono: true, sortable: true },
    { key: 'volumes', header: 'Volumes', width: 80, align: 'right', mono: true, sortable: true },
    { key: 'ready', header: 'Ready', width: 84, sortable: true, render: (n) => <StatusTag status={n.ready ? 'ready' : 'not ready'} /> },
    { key: 'schedulable', header: 'Scheduling', width: 100, sortable: true, render: (n) => <StatusTag status={n.schedulable ? 'active' : 'cordoned'} /> },
    { key: 'monthlyCents', header: 'Monthly', width: 96, align: 'right', mono: true, sortable: true, render: (n) => usd(n.monthlyCents) },
    {
      key: 'actions',
      header: '',
      width: 108,
      align: 'right',
      render: (n) => (
        <Button
          size="$2"
          chromeless
          disabled={busy === n.id}
          icon={<Ban size={13} />}
          onPress={(e) => {
            e.stopPropagation?.()
            void cordon(n, n.schedulable)
          }}
        >
          {n.schedulable ? 'Cordon' : 'Uncordon'}
        </Button>
      ),
    },
  ]

  return (
    <YStack gap="$3">
      <FilterBar q={q} onQ={setQ} placeholder="Search nodes…" options={NODE_OPTIONS} value={state} onChange={setState} />
      <DataTable columns={columns} rows={rows} loading={loading} rowKey={(n) => String(n.id)} onRowPress={setOpen} sort={sort} onSortChange={onSortChange} empty="No nodes." />
      <SlideOver open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} icon={Server} size={460}>
        {open ? (
          <YStack gap="$4">
            <YStack gap="$1">
              <Fact label="Droplet ID" value={String(open.id)} />
              <Fact label="Cluster" value={open.cluster || '—'} />
              <Fact label="Region" value={open.region} />
              <Fact label="Size" value={open.sizeSlug} />
              <Fact label="vCPU / memory" value={`${open.vcpus} · ${fmtBytes(open.memoryMiB * 1024 * 1024)}`} />
              <Fact label="Local disk" value={`${gib(open.localDiskGiB)} — included in the droplet price`} />
              <Fact label="Monthly" value={`${usd(open.monthlyCents)}/mo`} />
              <Fact label="Status" value={<StatusTag status={open.status} />} />
              <Fact label="Ready" value={open.ready ? 'Yes' : 'No'} />
              <Fact label="Scheduling" value={open.schedulable ? 'Schedulable' : 'Cordoned'} />
              <Fact label="Pods" value={String(open.pods)} />
              <Fact label="Volumes attached" value={String(open.volumes)} />
              <Fact label="Private / public IP" value={`${open.privateIp || '—'} · ${open.publicIp || '—'}`} />
              <Fact label="Created" value={open.createdAt ? fmtAgo(open.createdAt) : '—'} />
              <Fact label="Tags" value={open.tags.length ? open.tags.join(', ') : '—'} />
            </YStack>

            <YStack gap="$2">
              <Text fontSize="$4" fontWeight="700" color="$color12">Drain this node</Text>
              <ConfirmDelete
                message={drainMessage(open)}
                confirmLabel={`Drain ${open.name}`}
                run={async () => {
                  const r = await AdminInfraApi.cordonNode(open.id, true, true)
                  toast.success(`Drained ${r.name || open.name}`, `${r.evicted} pod${r.evicted === 1 ? '' : 's'} evicted.`)
                }}
                onDone={() => { setOpen(null); reload() }}
              />
            </YStack>
          </YStack>
        ) : null}
      </SlideOver>
    </YStack>
  )
}

// ── Volumes ───────────────────────────────────────────────────────────────────

const VOLUME_OPTIONS: Option<VolumeFilter>[] = [
  { label: 'All', value: 'all' },
  { label: 'Attached', value: 'attached' },
  { label: 'Bound', value: 'bound' },
  { label: 'Released', value: 'released' },
  { label: 'Unreferenced', value: 'unreferenced' },
]

const TONE_COLOR = { green: '$green11', yellow: '$yellow11', red: '$red11', neutral: '$color11' } as const

// fillOf joins the block-storage read onto an inventory volume. The two backends
// answer different questions about the SAME object — /v1/admin/infra knows whether a
// volume is referenced (and therefore safe to delete), /v1/admin/block-storage knows
// how full it is — so the board reads both and shows one row. Two boards for one
// noun is what this replaces; two READS for one row is fine, and each degrades on
// its own (no fill data → an honest em-dash, never a fabricated 0%).
function fillOf(fill: Map<string, StorageVolume>, v: InfraVolume): StorageVolume | undefined {
  return fill.get(v.id) ?? fill.get(v.name)
}

function VolumesTab({ data, loading, reload, toast }: { data: InfraSnapshot; loading: boolean; reload: () => void; toast: Toast }) {
  // Best-effort: a failure here must never blank the inventory the tab exists for.
  const [fill, setFill] = useState<Map<string, StorageVolume>>(new Map())
  useEffect(() => {
    let live = true
    StorageFleetApi.snapshot()
      .then((s) => {
        if (!live) return
        const m = new Map<string, StorageVolume>()
        for (const v of s.volumes) {
          m.set(v.id, v)
          m.set(v.name, v)
        }
        setFill(m)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const [q, setQ] = useState('')
  const [state, setState] = useState<VolumeFilter>('all')
  const [open, setOpen] = useState<InfraVolume | null>(null)
  const [snapshotFirst, setSnapshotFirst] = useState(true)
  const { sort, onSortChange, apply } = useSort('monthlyCents', 'desc')

  const rows = useMemo(() => apply(filterVolumes(data.volumes, q, state)), [data.volumes, q, state, apply])

  const columns: Column<InfraVolume>[] = [
    { key: 'name', header: 'Volume', sortable: true, render: (v) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{v.name}</Text> },
    {
      key: 'state',
      header: 'State',
      width: 122,
      sortable: true,
      render: (v) => <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color={TONE_COLOR[volumeStateTone(v.state)]}>{v.state}</Text>,
    },
    { key: 'sizeGiB', header: 'Size', width: 92, align: 'right', mono: true, sortable: true, render: (v) => gib(v.sizeGiB) },
    {
      key: 'fill',
      header: 'Fill',
      width: 84,
      align: 'right',
      mono: true,
      render: (v) => {
        const f = fillOf(fill, v)
        if (!f || f.pct == null) return '—'
        const tone = f.pct >= 90 ? '$red11' : f.pct >= 75 ? '$yellow11' : '$color11'
        return <Text fontSize="$2" color={tone}>{Math.round(f.pct)}%</Text>
      },
    },
    { key: 'monthlyCents', header: 'Monthly', width: 96, align: 'right', mono: true, sortable: true, render: (v) => usd(v.monthlyCents) },
    { key: 'region', header: 'Region', width: 80, sortable: true },
    { key: 'cluster', header: 'Cluster', width: 140, sortable: true, render: (v) => v.cluster || '—' },
    { key: 'nodeName', header: 'Node', width: 150, sortable: true, render: (v) => v.nodeName || '—' },
    { key: 'pvcName', header: 'PVC', width: 160, sortable: true, render: (v) => (v.pvcName ? `${v.pvcNamespace}/${v.pvcName}` : '—') },
    { key: 'mountedBy', header: 'Mounts', width: 80, align: 'right', mono: true, sortable: true, render: (v) => String(v.mountedBy.length) },
    { key: 'idle', header: 'Idle', width: 66, sortable: true, render: (v) => (v.idle ? 'Yes' : '—') },
    { key: 'createdAt', header: 'Created', width: 100, sortable: true, render: (v) => (v.createdAt ? fmtAgo(v.createdAt) : '—') },
    {
      key: 'deletable',
      header: 'Deletable',
      width: 100,
      sortable: true,
      // The gate, rendered: a non-deletable volume shows WHY, never a delete control.
      render: (v) => (canDelete(v) ? <StatusTag status="ready" /> : <Text fontSize="$1" color="$color10" numberOfLines={1}>{v.blockedReason || 'In use'}</Text>),
    },
  ]

  const reclaimable = rows.filter(canDelete)

  return (
    <YStack gap="$3">
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<HardDrive size={15} />} label="Volumes shown" value={String(rows.length)} caption={`of ${data.totals.volumes} in the fleet`} />
        <MetricCard icon={<Trash2 size={15} />} label="Deletable here" value={String(reclaimable.length)} caption={`${usd(reclaimable.reduce((s, v) => s + v.monthlyCents, 0))}/mo reclaimable`} />
        <MetricCard icon={<Layers size={15} />} label="Detached" value={String(data.totals.detachedVolumes)} caption={gib(data.totals.detachedGiB)} />
      </XStack>

      <FilterBar q={q} onQ={setQ} placeholder="Search volumes, PVCs, nodes…" options={VOLUME_OPTIONS} value={state} onChange={setState} />

      {!loading && data.volumes.length === 0 ? (
        <EmptyState icon={HardDrive} title="No block-storage volumes" description="This fleet has no DigitalOcean block-storage volumes — nothing to reclaim." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} rowKey={(v) => v.id} onRowPress={(v) => { setSnapshotFirst(true); setOpen(v) }} sort={sort} onSortChange={onSortChange} empty="No volumes match." />
      )}

      <SlideOver open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} icon={HardDrive} size={480}>
        {open ? (
          <YStack gap="$4">
            <YStack gap="$1">
              <Fact label="Volume ID" value={open.id} />
              <Fact label="State" value={<Text fontSize="$2" color={TONE_COLOR[volumeStateTone(open.state)]}>{open.state}</Text>} />
              <Fact label="Size" value={gib(open.sizeGiB)} />
              <Fact label="Cost" value={`${usd(open.monthlyCents)}/mo`} />
              <Fact label="Region" value={open.region} />
              <Fact label="Created" value={open.createdAt ? fmtAgo(open.createdAt) : '—'} />
            </YStack>

            <YStack gap="$1">
              <Text fontSize="$4" fontWeight="700" color="$color12">Kubernetes binding</Text>
              <Fact label="PV" value={open.pv || '—'} />
              <Fact label="PV phase" value={open.pvPhase || '—'} />
              <Fact label="PVC" value={open.pvcName ? `${open.pvcNamespace}/${open.pvcName}` : '—'} />
              <Fact label="Mounting pods" value={open.mountedBy.length ? open.mountedBy.join(', ') : 'None'} />
              <Fact label="Idle" value={open.idle ? 'Bound to a PVC, but no pod mounts it' : 'No'} />
              <Fact label="Attached droplets" value={open.dropletIds.length ? open.dropletIds.join(', ') : '—'} />
              <Fact label="Node" value={open.nodeName || '—'} />
            </YStack>

            <YStack gap="$1">
              <Text fontSize="$4" fontWeight="700" color="$color12">Cluster ownership</Text>
              <Fact label="Proven (via PV)" value={open.cluster || 'None — no cluster claims this volume'} />
              <Fact label="Tag says" value={open.tagCluster || '—'} />
              {open.tagCluster && open.tagCluster !== open.clusterId && open.tagCluster !== open.cluster ? (
                <Text fontSize="$2" color="$yellow11" pt="$1">
                  The `k8s:` tag disagrees with the proven owner. The tag is ADVISORY — only a PV binding proves ownership,
                  so the tag alone never makes a volume safe or unsafe to delete.
                </Text>
              ) : null}
            </YStack>

            <YStack gap="$2.5">
              <Text fontSize="$4" fontWeight="700" color="$color12">Delete</Text>
              {canDelete(open) ? (
                <>
                  <XStack items="center" justify="space-between" gap="$3">
                    <YStack flex={1} minW={180}>
                      <Text fontSize="$3" color="$color12">Take a snapshot first</Text>
                      <Text fontSize="$1" color="$color10">Recommended — the data can then be restored.</Text>
                    </YStack>
                    <FieldSwitch checked={snapshotFirst} onChange={setSnapshotFirst} />
                  </XStack>
                  <ConfirmDelete
                    message={deleteMessage(open, snapshotFirst)}
                    confirmLabel={`Delete ${open.name}`}
                    run={async () => {
                      const r = await AdminInfraApi.deleteVolume(open.id, snapshotFirst)
                      toast.success(
                        `Deleted ${r.name || open.name}`,
                        `${usd(r.freedMonthlyCents || open.monthlyCents)}/mo reclaimed${r.snapshotId ? ` · snapshot ${r.snapshotId}` : ''}.`,
                      )
                    }}
                    onDone={() => { setOpen(null); reload() }}
                  />
                </>
              ) : (
                // No control at all — an offer the server would refuse is worse than none.
                <Card borderWidth={1} borderColor="$borderColor" bg="$color2" p="$3" gap="$1.5">
                  <XStack gap="$2" items="center">
                    <ShieldAlert size={15} color="$color10" />
                    <Text fontSize="$3" fontWeight="700" color="$color12">This volume cannot be deleted</Text>
                  </XStack>
                  <Text fontSize="$2" color="$color11">
                    {open.blockedReason || `It is ${open.state} — only a volume proven unreferenced by a complete scan can be deleted.`}
                  </Text>
                </Card>
              )}
            </YStack>
          </YStack>
        ) : null}
      </SlideOver>
    </YStack>
  )
}

// ── Load balancers ────────────────────────────────────────────────────────────

function LoadBalancersTab({ data, loading }: { data: InfraSnapshot; loading: boolean }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState<InfraLoadBalancer | null>(null)
  const { sort, onSortChange, apply } = useSort('monthlyCents', 'desc')

  const options = useMemo(() => ALL_OPT<string>(distinctValues(data.loadBalancers, (l) => l.status)), [data.loadBalancers])
  const rows = useMemo(
    () => apply(filterByStatus(data.loadBalancers, q, status, (l) => l.status, (l) => `${l.name} ${l.id} ${l.region} ${l.ip} ${l.cluster}`)),
    [data.loadBalancers, q, status, apply],
  )

  const columns: Column<InfraLoadBalancer>[] = [
    { key: 'name', header: 'Load balancer', sortable: true, render: (l) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{l.name}</Text> },
    { key: 'region', header: 'Region', width: 90, sortable: true },
    { key: 'status', header: 'Status', width: 110, sortable: true, render: (l) => <StatusTag status={l.status} /> },
    { key: 'ip', header: 'IP', width: 130, mono: true, sortable: true, render: (l) => l.ip || '—' },
    { key: 'sizeUnit', header: 'Units', width: 74, align: 'right', mono: true, sortable: true },
    { key: 'droplets', header: 'Droplets', width: 88, align: 'right', mono: true, sortable: true },
    { key: 'cluster', header: 'Cluster', width: 150, sortable: true, render: (l) => l.cluster || '—' },
    { key: 'monthlyCents', header: 'Monthly', width: 100, align: 'right', mono: true, sortable: true, render: (l) => usd(l.monthlyCents) },
  ]

  return (
    <YStack gap="$3">
      <FilterBar q={q} onQ={setQ} placeholder="Search load balancers…" options={options} value={status} onChange={setStatus} />
      <DataTable columns={columns} rows={rows} loading={loading} rowKey={(l) => l.id} onRowPress={setOpen} sort={sort} onSortChange={onSortChange} empty="No load balancers." />
      <SlideOver open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} icon={Network} size={440}>
        {open ? (
          <YStack gap="$1">
            <Fact label="ID" value={open.id} />
            <Fact label="Region" value={open.region} />
            <Fact label="Status" value={<StatusTag status={open.status} />} />
            <Fact label="IP" value={open.ip || '—'} />
            <Fact label="Size units" value={String(open.sizeUnit)} />
            <Fact label="Droplets behind it" value={String(open.droplets)} />
            <Fact label="Cluster" value={open.cluster || '—'} />
            <Fact label="Monthly" value={`${usd(open.monthlyCents)}/mo`} />
          </YStack>
        ) : null}
      </SlideOver>
    </YStack>
  )
}

// ── Audit ─────────────────────────────────────────────────────────────────────

const SEV_OPTIONS: Option<FindingFilter>[] = [
  { label: 'All', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'Warn', value: 'warn' },
  { label: 'Info', value: 'info' },
]

function AuditTab({ data, loading }: { data: InfraSnapshot; loading: boolean }) {
  const [q, setQ] = useState('')
  const [sev, setSev] = useState<FindingFilter>('all')
  const [open, setOpen] = useState<InfraFinding | null>(null)
  const { sort, onSortChange, apply } = useSort('monthlyCents', 'desc')

  const groups = useMemo(() => groupFindings(filterFindings(data.findings, q, sev)), [data.findings, q, sev])
  const impact = data.findings.reduce((s, f) => s + f.monthlyCents, 0)

  const columns: Column<InfraFinding>[] = [
    { key: 'title', header: 'Finding', sortable: true, render: (f) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{f.title}</Text> },
    { key: 'kind', header: 'Kind', width: 150, sortable: true, mono: true },
    { key: 'resource', header: 'Resource', width: 190, sortable: true, render: (f) => f.resource || '—' },
    { key: 'cluster', header: 'Cluster', width: 140, sortable: true, render: (f) => f.cluster || '—' },
    { key: 'monthlyCents', header: 'Cost impact', width: 110, align: 'right', mono: true, sortable: true, render: (f) => usd(f.monthlyCents) },
  ]

  return (
    <YStack gap="$3">
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<ShieldAlert size={15} />} label="Findings" value={String(data.findings.length)} caption={`${groups.length} severit${groups.length === 1 ? 'y' : 'ies'} shown`} />
        <MetricCard icon={<Trash2 size={15} />} label="Cost impact" value={usd(impact)} caption="Monthly spend the findings account for" />
      </XStack>

      <FilterBar q={q} onQ={setQ} placeholder="Search findings…" options={SEV_OPTIONS} value={sev} onChange={setSev} />

      {loading && data.findings.length === 0 ? (
        <DataTable columns={columns} rows={[]} loading rowKey={(f) => f.id} />
      ) : groups.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No findings" description="The last complete scan raised nothing — no unreferenced volumes, idle PVCs, released PVs, or cost outliers." />
      ) : (
        groups.map((grp) => (
          <Panel
            key={grp.severity}
            grow={false}
            title={`${grp.severity} · ${grp.findings.length}`}
            right={<Text fontSize="$2" color={TONE_COLOR[severityTone(grp.severity)]}>{usd(grp.monthlyCents)}/mo</Text>}
          >
            <DataTable columns={columns} rows={apply(grp.findings)} rowKey={(f) => f.id} onRowPress={setOpen} sort={sort} onSortChange={onSortChange} />
          </Panel>
        ))
      )}

      <SlideOver open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} icon={ShieldAlert} size={460}>
        {open ? (
          <YStack gap="$3">
            <YStack gap="$1">
              <Fact label="Severity" value={<Text fontSize="$2" color={TONE_COLOR[severityTone(open.severity)]}>{open.severity}</Text>} />
              <Fact label="Kind" value={open.kind} />
              <Fact label="Resource" value={open.resource || '—'} />
              <Fact label="Cluster" value={open.cluster || '—'} />
              <Fact label="Cost impact" value={`${usd(open.monthlyCents)}/mo`} />
            </YStack>
            <Text fontSize="$3" color="$color11">{open.detail || 'No further detail reported.'}</Text>
          </YStack>
        ) : null}
      </SlideOver>
    </YStack>
  )
}
