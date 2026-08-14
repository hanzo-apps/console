'use client'

/**
 * Machines — your compute machines and capacity across regions.
 *
 * Routes by role. A CUSTOMER reads THEIR OWN machines from the native `/v1/machines`
 * surface (`CustomerMachines`, visor-backed via the user-bearer `/v1` proxy) — real
 * data, a launch flow, and a terminate action. A GLOBAL ADMIN sees the operator FLEET
 * view here (`AdminMachines`): a MACHINE is one node of a real cluster pool, projected
 * from the org's dedicated DOKS clusters (`GET /v1/clusters`, the native cloud surface,
 * org-scoped by the Bearer owner). `machines/logic.ts` projects nodes from clusters;
 * every field is a real cluster/pool value, a deterministic function of one (vCPU/RAM
 * from the size slug; monthly cost ESTIMATE from the price table), or an explicit "—"
 * for facts the control plane does not expose (per-node CPU%/MEM%/GPU/uptime/IP).
 * Nothing is fabricated.
 *
 * States are honest and mirror the other modules: loading, forbidden (a non-admin
 * caller of the fleet view → a "managed by Hanzo" state), backend-unavailable (404),
 * error, and a genuine empty (load succeeded, zero clusters). Per-node Reboot/Terminate
 * on the fleet view have no cluster-level endpoint, so they are disabled with a tooltip;
 * capacity is changed on the node pool from Clusters. (Per-machine terminate for a
 * customer's own machine lives on the customer view, wired to DELETE /v1/machines/:id.)
 *
 * Org scope is `currentOrg()` (brand org by default; the native surfaces resolve the
 * org from the Bearer owner server-side).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  Gauge,
  HardDrive,
  KeyRound,
  Layers,
  MemoryStick,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  Shield,
  Terminal,
  Trash2,
  Upload,
} from '@hanzogui/lucide-icons-2'
import { useRouter } from '~/lib/router'

import { PlatformApi, type Cluster } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { CustomerMachines } from './machines/CustomerMachines'
import { Donut, type DonutSegment } from '~/components/ui/Donut'
import { toneVar, type Tone } from '~/components/ui/tone'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'
import {
  type Machine,
  type MachineStatus,
  machinesFromClusters,
  summarize,
  filterMachines,
  distinct,
  paginate,
  pageCount,
  parseInstanceType,
  regionFlag,
  regionLabel,
  clusterNodeCount,
  ageFrom,
  fmtUsd,
  fmtMemGb,
  MACHINE_STATUS_LABEL,
} from './machines/logic'
import { DataTable, EmptyState, FieldSelect, PageHeader, type Column } from '@hanzo/ui/product'

const TABS = ['Overview', 'Machines', 'Groups', 'Images', 'Scripts', 'SSH Keys', 'Policies', 'Settings'] as const
type Tab = (typeof TABS)[number]

const DETAIL_TABS = ['Overview', 'Metrics', 'Disks', 'Networking', 'Logs'] as const
type DetailTab = (typeof DETAIL_TABS)[number]

const PAGE_SIZE = 10
const DASH = '—'

/** Status → tone (donut + dot + pill). One source of truth — the console tone map. */
const STATUS_TONE: Record<MachineStatus, Tone> = {
  online: 'positive',
  busy: 'warning',
  offline: 'critical',
}

// ── Small presentational helpers ─────────────────────────────────────────────

/** Native-title tooltip wrapper (web) — used to explain disabled actions. */
function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  return <span title={text} style={{ display: 'inline-flex' }}>{children}</span>
}

/** A colored status dot — inline SVG so the color is a raw hex (matches Donut). */
function Dot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill={color} />
    </svg>
  )
}

function StatusPill({ status }: { status: MachineStatus }) {
  return (
    <XStack items="center" gap="$1.5">
      <Dot color={toneVar(STATUS_TONE[status])} size={8} />
      <Text fontSize="$2" color="$color12">
        {MACHINE_STATUS_LABEL[status]}
      </Text>
    </XStack>
  )
}

function Metric({
  icon,
  label,
  value,
  sub,
  muted,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  muted?: boolean
}) {
  return (
    <Card flex={1} minW={168} p="$3" gap="$2" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        {icon}
        <Text fontSize="$2" color="$color11">
          {label}
        </Text>
      </XStack>
      <Text fontSize="$8" fontWeight="900" color={muted ? '$color10' : '$color12'}>
        {value}
      </Text>
      {sub ? (
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Card>
  )
}

/** Honest inline panel for a surface the control plane does not expose. */
function MutedPanel({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$5" gap="$2" items="center">
      <YStack width={40} height={40} items="center" justify="center" rounded="$4" bg="$color3">
        {icon}
      </YStack>
      <Text fontSize="$4" fontWeight="700" text="center">
        {title}
      </Text>
      <Text fontSize="$2" color="$color11" text="center" maxW={460}>
        {body}
      </Text>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3" items="flex-start">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" numberOfLines={1} text="right" flex={1}>
        {value}
      </Text>
    </XStack>
  )
}

/** Segmented tab bar — reused for the page tabs and the detail-rail tabs. */
function TabRow<T extends string>({ tabs, active, onChange }: { tabs: readonly T[]; active: T; onChange: (t: T) => void }) {
  return (
    <XStack gap="$1" flexWrap="wrap" borderBottomWidth={1} borderColor="$borderColor" pb="$1">
      {tabs.map((t) => (
        <Button
          key={t}
          size="$2"
          chromeless={active !== t}
          theme={active === t ? 'light' : undefined}
          onPress={() => onChange(t)}
        >
          {t}
        </Button>
      ))}
    </XStack>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
      {children}
    </Text>
  )
}

// ── Module ───────────────────────────────────────────────────────────────────

/**
 * Machines — routes by role. A CUSTOMER (non-global-admin) sees THEIR OWN machines
 * via the user-scoped visor `/v1/vm` proxy (`CustomerMachines`) — real data or a
 * graceful "launch one" state, never the infra "PAAS_SERVICE_TOKEN not set"
 * message. A GLOBAL ADMIN sees the platform fleet across every cluster
 * (`AdminMachines`, over the `/paas` control plane), whose honest not-configured
 * state IS the right thing for an operator. One wrapper, one hook — no
 * rules-of-hooks hazard (each branch is a full component with its own hooks).
 */
export function MachinesModule(props: { params: Record<string, string> }) {
  const showAdmin = useIsSuperAdmin()
  return showAdmin ? <AdminMachines {...props} /> : <CustomerMachines />
}

function AdminMachines(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const [tab, setTab] = useState<Tab>('Overview')
  const [q, setQ] = useState('')
  const [fGroup, setFGroup] = useState('all')
  const [fRegion, setFRegion] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const [fType, setFType] = useState('all')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('Overview')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await PlatformApi.listClusters()
      setClusters(data ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setClusters([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const machines = useMemo(() => machinesFromClusters(clusters), [clusters])
  const summary = useMemo(() => summarize(machines), [machines])
  const filtered = useMemo(
    () => filterMachines(machines, { q, group: fGroup, region: fRegion, status: fStatus, type: fType }),
    [machines, q, fGroup, fRegion, fStatus, fType],
  )
  const pages = pageCount(filtered.length, PAGE_SIZE)
  const safePage = Math.min(page, pages - 1)
  const pageRows = paginate(filtered, safePage, PAGE_SIZE)
  const selected = useMemo(() => machines.find((m) => m.id === selectedId) ?? null, [machines, selectedId])

  const select = (m: Machine) => {
    setSelectedId(m.id)
    setDetailTab('Overview')
  }

  // ── Table columns (per-node live metrics are honest "—") ───────────────────
  const columns: Column<Machine>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <YStack>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {m.name}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {m.instanceId}
          </Text>
        </YStack>
      ),
    },
    { key: 'group', header: 'Group', width: 120, render: (m) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{m.group}</Text> },
    {
      key: 'region',
      header: 'Region',
      width: 120,
      render: (m) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {m.region ? `${regionFlag(m.region)} ${m.region}`.trim() : DASH}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 140,
      render: (m) => (
        <YStack>
          <Text fontSize="$3" color="$color11" numberOfLines={1}>{m.type || DASH}</Text>
          {m.vcpu != null && m.memGb != null ? (
            <Text fontSize="$1" color="$color10">{m.vcpu} vCPU · {m.memGb} GB</Text>
          ) : null}
        </YStack>
      ),
    },
    { key: 'status', header: 'Status', width: 100, render: (m) => <StatusPill status={m.status} /> },
    { key: 'cpu', header: 'CPU%', width: 66, render: () => <Text fontSize="$3" color="$color10">{DASH}</Text> },
    { key: 'mem', header: 'Mem%', width: 66, render: () => <Text fontSize="$3" color="$color10">{DASH}</Text> },
    { key: 'gpu', header: 'GPU', width: 60, render: () => <Text fontSize="$3" color="$color10">{DASH}</Text> },
    { key: 'uptime', header: 'Uptime', width: 80, render: () => <Text fontSize="$3" color="$color10">{DASH}</Text> },
    {
      key: 'cost',
      header: 'Cost/mo',
      width: 96,
      render: (m) => (
        <Text fontSize="$3" color="$color12">
          {m.costMonthlyUsd != null ? `${fmtUsd(m.costMonthlyUsd)}` : DASH}
        </Text>
      ),
    },
  ]

  // ── Donut segments (real status counts) ────────────────────────────────────
  const donutSegments: DonutSegment[] = (['online', 'busy', 'offline'] as MachineStatus[]).map((s) => ({
    label: MACHINE_STATUS_LABEL[s],
    value: summary.byStatus[s],
    color: toneVar(STATUS_TONE[s]),
  }))

  const header = (
    <PageHeader
      title="Machines"
      subtitle="Manage your compute machines and capacity across regions."
      actions={
        <XStack gap="$2" flexWrap="wrap">
          <Button size="$2" icon={<Plus size={15} />} onPress={() => router.push('/clusters')}>
            Add machine
          </Button>
          <Button size="$2" icon={<Upload size={15} />} onPress={() => router.push('/clusters')}>
            Import
          </Button>
          <Button size="$2" icon={<Layers size={15} />} onPress={() => router.push('/clusters')}>
            Create group
          </Button>
          <Button size="$2" chromeless icon={<RefreshCw size={15} />} onPress={() => void load()}>
            Refresh
          </Button>
        </XStack>
      }
    />
  )

  // Honest gates shared by the data tabs (Overview / Machines / Groups).
  const dataGate = (renderContent: () => React.ReactNode): React.ReactNode => {
    if (loading) {
      return (
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      )
    }
    if (loadError) {
      return <PlatformStateCard error={loadError} onRetry={() => void load()} />
    }
    if (clusters.length === 0) {
      return (
        <EmptyState
          icon={Server}
          title="No machines yet"
          description="Compute machines are the nodes of your Hanzo K8S (DigitalOcean Kubernetes) clusters. Provision a cluster to add capacity across regions."
          bullets={[
            'A cluster is a group of machines (a node pool of identically-sized droplets).',
            'Machines, cores, memory, and estimated cost are read from your real clusters.',
            'Workloads otherwise run on shared Hanzo Cloud — no machine to manage there.',
          ]}
          primary={{ label: 'Provision a cluster', onPress: () => router.push('/clusters') }}
          secondary={{ label: 'View clusters', onPress: () => router.push('/clusters') }}
        />
      )
    }
    return renderContent()
  }

  return (
    <>
      {header}
      <TabRow tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Overview' ? dataGate(renderOverview) : null}
      {tab === 'Machines' ? dataGate(renderExplorer) : null}
      {tab === 'Groups' ? dataGate(renderGroups) : null}
      {tab === 'Images' ? (
        <MutedPanel
          icon={<HardDrive size={20} />}
          title="Images are managed by DOKS"
          body="DigitalOcean Kubernetes provisions nodes from a managed image; the control plane does not expose a per-org machine-image catalog. Custom workload images live in your container registry."
        />
      ) : null}
      {tab === 'Scripts' ? (
        <MutedPanel
          icon={<FileText size={20} />}
          title="No startup-scripts surface yet"
          body="Node bootstrap is handled by the operator baseline at provision time. A per-machine startup-script API is not exposed by the control plane, so nothing is shown here rather than a placeholder."
        />
      ) : null}
      {tab === 'SSH Keys' ? (
        <MutedPanel
          icon={<KeyRound size={20} />}
          title="Nodes are managed — no direct SSH"
          body="DOKS nodes are managed; you operate them with kubectl through the cluster endpoint, not per-node SSH keys. No SSH-key registry is exposed by the control plane."
        />
      ) : null}
      {tab === 'Policies' ? (
        <MutedPanel
          icon={<Shield size={20} />}
          title="No machine-policy surface yet"
          body="Placement, autoscaling, and maintenance policies belong to the node pool, so you set them on the cluster. There is no per-machine policy API."
        />
      ) : null}
      {tab === 'Settings' ? renderSettings() : null}
    </>
  )

  // ── Tab bodies — plain render functions (called, NOT mounted as components,
  // so the search input keeps focus and no subtree remounts on each keystroke).
  // They close over the state above and call no hooks of their own.

  function renderOverview() {
    const partial = !summary.costComplete && summary.monthlyCostUsd > 0
    return (
      <YStack gap="$4">
        <XStack gap="$3" flexWrap="wrap">
          <Metric icon={<Server size={16} />} label="Total machines" value={String(summary.total)} sub={`across ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}`} />
          <Metric icon={<Activity size={16} />} label="Online" value={String(summary.online)} sub={`${summary.byStatus.busy} busy · ${summary.byStatus.offline} offline`} />
          <Metric icon={<Gauge size={16} />} label="CPU util avg" value={DASH} sub="metrics not connected" muted />
          <Metric icon={<Gauge size={16} />} label="Mem util avg" value={DASH} sub="metrics not connected" muted />
          <Metric icon={<Cpu size={16} />} label="Total cores" value={String(summary.totalCores)} sub="vCPU" />
          <Metric icon={<MemoryStick size={16} />} label="Total memory" value={fmtMemGb(summary.totalMemGb)} />
          <Metric icon={<ExternalLink size={16} />} label="Monthly est. cost" value={`${partial ? '≥ ' : ''}${fmtUsd(summary.monthlyCostUsd)}`} sub={partial ? 'est. · DO list price (partial)' : 'est. · DO list price'} />
        </XStack>

        <XStack gap="$3" flexWrap="wrap">
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" minW={300}>
            <Text fontSize="$4" fontWeight="700">Machines by status</Text>
            <XStack gap="$4" items="center">
              <Donut segments={donutSegments} size={148} centerValue={String(summary.total)} centerLabel="machines" />
              <YStack gap="$2">
                {donutSegments.map((s) => (
                  <XStack key={s.label} items="center" gap="$2">
                    <Dot color={s.color} size={10} />
                    <Text fontSize="$2" color="$color11">{s.label}</Text>
                    <Text fontSize="$2" fontWeight="700" color="$color12">{s.value}</Text>
                  </XStack>
                ))}
              </YStack>
            </XStack>
          </Card>

          <Card flex={1} minW={320} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" justify="center">
            <Text fontSize="$4" fontWeight="700">Machines over time</Text>
            <MutedPanel
              icon={<Activity size={18} />}
              title="No utilization history yet"
              body="A multi-line utilization history appears here once a metrics source (Prometheus / Observability) is connected. The control plane does not retain per-node time series, so no line is drawn until then."
            />
          </Card>
        </XStack>

        <YStack gap="$2">
          <XStack justify="space-between" items="center">
            <Text fontSize="$4" fontWeight="700">Machines</Text>
            {machines.length > 8 ? (
              <Button size="$2" chromeless iconAfter={<ChevronRight size={14} />} onPress={() => setTab('Machines')}>
                View all {machines.length}
              </Button>
            ) : null}
          </XStack>
          <Text fontSize="$1" color="$color10">
            Live per-node metrics (CPU / Mem / GPU / uptime) require a connected metrics source — shown as {DASH} until then. Cost/mo is an estimate from the node size (DigitalOcean list price).
          </Text>
          <DataTable
            columns={columns}
            rows={machines.slice(0, 8)}
            rowKey={(m) => m.id}
            onRowPress={(m) => { select(m); setTab('Machines') }}
            empty="No machines in your clusters yet."
          />
        </YStack>
      </YStack>
    )
  }

  function renderExplorer() {
    return (
      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={1} minW={420} gap="$3">
          {/* toolbar */}
          <XStack gap="$2" flexWrap="wrap" items="flex-end">
            <XStack flex={1} minW={200} items="center" gap="$2" px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3">
              <Search size={15} />
              <Input
                flex={1}
                unstyled
                value={q}
                onChangeText={(v: string) => { setQ(v); setPage(0) }}
                placeholder="Search name, id, group, region, type…"
                autoCapitalize="none"
                py="$2"
              />
            </XStack>
            <FilterSelect label="Group" value={fGroup} options={['all', ...distinct(machines, 'group')]} onChange={(v) => { setFGroup(v); setPage(0) }} />
            <FilterSelect label="Region" value={fRegion} options={['all', ...distinct(machines, 'region')]} onChange={(v) => { setFRegion(v); setPage(0) }} />
            <FilterSelect label="Status" value={fStatus} options={['all', 'online', 'busy', 'offline']} onChange={(v) => { setFStatus(v); setPage(0) }} />
            <FilterSelect label="Type" value={fType} options={['all', ...distinct(machines, 'type')]} onChange={(v) => { setFType(v); setPage(0) }} />
          </XStack>

          <Text fontSize="$1" color="$color10">
            {filtered.length} of {machines.length} machines · per-node metrics (CPU / Mem / GPU / uptime) need a connected metrics source — shown as {DASH}. Cost/mo is an estimate (DigitalOcean list price for the node size).
          </Text>

          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(m) => m.id}
            onRowPress={select}
            empty="No machines match these filters."
          />

          {/* pagination */}
          {filtered.length > PAGE_SIZE ? (
            <XStack justify="space-between" items="center">
              <Text fontSize="$2" color="$color10">
                Page {safePage + 1} of {pages} · {filtered.length} machines
              </Text>
              <XStack gap="$2">
                <Button size="$2" chromeless icon={<ChevronLeft size={15} />} disabled={safePage <= 0} onPress={() => setPage(safePage - 1)}>
                  Prev
                </Button>
                <Button size="$2" chromeless iconAfter={<ChevronRight size={15} />} disabled={safePage >= pages - 1} onPress={() => setPage(safePage + 1)}>
                  Next
                </Button>
              </XStack>
            </XStack>
          ) : null}
        </YStack>

        {/* right rail */}
        <YStack width={360} minW={300} gap="$3">
          {selected ? renderDetail(selected) : (
            <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$5" items="center" gap="$2">
              <Server size={20} />
              <Text fontSize="$3" fontWeight="700">Select a machine</Text>
              <Text fontSize="$2" color="$color11" text="center">Pick a row to see its instance facts, networking, and actions.</Text>
            </Card>
          )}
        </YStack>
      </XStack>
    )
  }

  function renderDetail(machine: Machine) {
    const spec = parseInstanceType(machine.type)
    const noAction = 'Per-node actions are not exposed by the control plane. Manage capacity at the cluster level (Groups → Clusters).'
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <YStack gap="$1">
          <Text fontSize="$5" fontWeight="800" numberOfLines={1}>{machine.name}</Text>
          <XStack items="center" gap="$2">
            <StatusPill status={machine.status} />
            <Text fontSize="$1" color="$color10">·</Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>{machine.instanceId}</Text>
          </XStack>
        </YStack>

        <TabRow tabs={DETAIL_TABS} active={detailTab} onChange={setDetailTab} />

        {detailTab === 'Overview' ? (
          <YStack gap="$2">
            <Fact label="Instance ID" value={machine.instanceId} />
            <Fact label="Cluster / pool" value={`${machine.group}${machine.poolName ? ` / ${machine.poolName}` : ''}`} />
            <Fact label="Region / AZ" value={machine.region ? `${regionFlag(machine.region)} ${regionLabel(machine.region)} (${machine.region})`.trim() : DASH} />
            <Fact label="Instance type" value={machine.type ? `${machine.type} · ${spec.label}` : DASH} />
            <Fact label="Family" value={spec.family} />
            <Fact label="Launched" value={machine.createdAt ? new Date(machine.createdAt).toLocaleString() : DASH} />
            <Fact label="Cluster age" value={ageFrom(machine.createdAt)} />
            <Fact label="OS / image" value="Managed (DOKS)" />
            <Fact label="k8s version" value={machine.k8sVersion ?? DASH} />
            <Fact label="Private IP" value={DASH} />
            <Fact label="Public IP" value={DASH} />
            <Fact label="SSH" value="kubectl (managed node)" />
            <Fact label="Est. cost" value={machine.costMonthlyUsd != null ? `${fmtUsd(machine.costMonthlyUsd)} /mo` : DASH} />
          </YStack>
        ) : null}

        {detailTab === 'Metrics' ? (
          <MutedPanel icon={<Gauge size={18} />} title="Per-node metrics not connected" body="CPU / memory / GPU history for this node isn't exposed by the control plane. Connect a metrics source (Prometheus / Observability) to populate these sparklines." />
        ) : null}

        {detailTab === 'Disks' ? (
          <MutedPanel icon={<HardDrive size={18} />} title="Disk inventory not exposed" body="Per-node block-device details aren't returned by the control plane. Persistent volumes are managed as cluster storage." />
        ) : null}

        {detailTab === 'Networking' ? (
          <YStack gap="$2">
            <Fact label="Cluster endpoint" value={machine.endpoint ?? DASH} />
            <Fact label="Private IP" value={DASH} />
            <Fact label="Public IP" value={DASH} />
            <Text fontSize="$1" color="$color10">
              Node IPs aren't exposed by the control plane; traffic reaches workloads through the cluster ingress / endpoint above.
            </Text>
          </YStack>
        ) : null}

        {detailTab === 'Logs' ? (
          <MutedPanel icon={<FileText size={18} />} title="Node logs not exposed here" body="Node-level logs aren't surfaced by the control plane. Workload logs live in Logs / Observability." />
        ) : null}

        {/* Quick actions — all honest-disabled (no per-node endpoint exists). */}
        <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
          <Text fontSize="$2" fontWeight="700" color="$color11">Quick actions</Text>
          <XStack gap="$2" flexWrap="wrap">
            <Hint text="No per-node SSH — these are managed DOKS nodes. Use kubectl via the cluster endpoint.">
              <Button size="$2" disabled icon={<Terminal size={14} />}>SSH</Button>
            </Hint>
            <Hint text={noAction}>
              <Button size="$2" disabled icon={<Activity size={14} />}>Metrics</Button>
            </Hint>
            <Hint text={noAction}>
              <Button size="$2" disabled icon={<Settings size={14} />}>Edit</Button>
            </Hint>
            <Hint text="No per-node reboot endpoint. Reboot/replace happens at the node-pool level on the cluster.">
              <Button size="$2" disabled icon={<RotateCcw size={14} />}>Reboot</Button>
            </Hint>
            <Hint text="No per-node termination endpoint. Removing capacity destroys/scales the node pool at the cluster level — done from Clusters, with confirmation.">
              <Button size="$2" disabled theme="red" icon={<Trash2 size={14} />}>Terminate</Button>
            </Hint>
          </XStack>
          <Text fontSize="$1" color="$color10">{noAction}</Text>
        </YStack>

        {/* Tags — real cluster/pool facts. */}
        <YStack gap="$2">
          <Text fontSize="$2" fontWeight="700" color="$color11">Tags</Text>
          <XStack gap="$1.5" flexWrap="wrap">
            <Chip>{spec.family}</Chip>
            {machine.region ? <Chip>{machine.region}</Chip> : null}
            {machine.k8sVersion ? <Chip>k8s {machine.k8sVersion}</Chip> : null}
            {machine.ha ? <Chip>HA</Chip> : null}
            {machine.active ? <Chip>deploy target</Chip> : null}
            {machine.tags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </XStack>
        </YStack>
      </Card>
    )
  }

  function renderGroups() {
    const cols: Column<Cluster>[] = [
      { key: 'name', header: 'Cluster', render: (c) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{c.name}</Text> },
      { key: 'status', header: 'Status', width: 130, render: (c) => <Text fontSize="$2" color="$color11">{c.phase || c.status}</Text> },
      { key: 'region', header: 'Region', width: 120, render: (c) => <Text fontSize="$3" color="$color11">{c.region ? `${regionFlag(c.region)} ${c.region}`.trim() : DASH}</Text> },
      { key: 'nodes', header: 'Machines', width: 100, render: (c) => <Text fontSize="$3" color="$color11">{clusterNodeCount(c)}</Text> },
      {
        key: 'pools',
        header: 'Pools',
        width: 200,
        render: (c) => (
          <Text fontSize="$2" color="$color11" numberOfLines={1}>
            {(c.nodePools && c.nodePools.length)
              ? c.nodePools.map((p) => `${p.size ?? DASH}×${p.count ?? 0}`).join(', ')
              : (c.nodeSize ? `${c.nodeSize}×${c.nodeCount ?? 1}` : DASH)}
          </Text>
        ),
      },
      { key: 'version', header: 'k8s', width: 110, render: (c) => <Text fontSize="$2" color="$color10">{c.k8sVersion ?? c.version ?? DASH}</Text> },
      { key: 'age', header: 'Age', width: 80, render: (c) => <Text fontSize="$2" color="$color10">{ageFrom(c.createdAt)}</Text> },
    ]
    return (
      <YStack gap="$2">
        <XStack justify="space-between" items="center">
          <Text fontSize="$4" fontWeight="700">Groups (clusters)</Text>
          <Button size="$2" icon={<Plus size={15} />} onPress={() => router.push('/clusters')}>
            Provision cluster
          </Button>
        </XStack>
        <Text fontSize="$1" color="$color10">A group is a Hanzo K8S cluster; its machines are the nodes of its pools. Cluster lifecycle (provision / destroy) lives in Clusters.</Text>
        <DataTable columns={cols} rows={clusters} rowKey={(c) => c.doksClusterId ?? c.id ?? c.name} empty="No clusters yet." />
      </YStack>
    )
  }

  function renderSettings() {
    const configured = !loadError || loadError.kind === 'unavailable'
    const stateLabel = loadError
      ? (loadError.kind === 'not-configured' ? 'Not configured' : loadError.kind === 'unavailable' ? 'Backend unavailable' : 'Error')
      : 'Connected'
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" maxW={620}>
        <Text fontSize="$5" fontWeight="800">Settings</Text>
        <YStack gap="$2">
          <Fact label="Org scope" value={currentOrg()} />
          <Fact label="Backend" value="cloud-api (via /v1 user-bearer proxy)" />
          <Fact label="Inventory source" value="GET /v1/clusters → node pools" />
          <Fact label="Connection" value={stateLabel} />
          <Fact label="Clusters" value={String(clusters.length)} />
          <Fact label="Machines" value={String(machines.length)} />
        </YStack>
        {!configured ? (
          <Text fontSize="$2" color="$color11">
            The cluster inventory could not be read on this deployment. Machines are the nodes in your cluster pools, so this page fills in once that read succeeds.
          </Text>
        ) : null}
        <XStack>
          <Button size="$2" iconAfter={<ExternalLink size={14} />} onPress={() => router.push('/clusters')}>
            Manage clusters
          </Button>
        </XStack>
      </Card>
    )
  }
}

/** A compact labeled filter select for the explorer toolbar. */
function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <YStack gap="$1" minW={132}>
      <Text fontSize="$1" color="$color10">{label}</Text>
      <FieldSelect value={value} options={options} onChange={onChange} />
    </YStack>
  )
}
