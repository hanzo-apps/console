'use client'

/**
 * Kubernetes — the org's UNIFIED COMPUTE FLEET in one place.
 *
 * ONE surface reads the two live, tenant-scoped cloud sources (org resolved from
 * the Bearer owner by the same-origin `/v1` proxy):
 *   - `GET /v1/clusters` — the org's clusters, managed (Visor-provisioned DOKS) and
 *     attached BYO ones MERGED, each with its kind, node count, status, and the GPU
 *     inventory a BYO cluster reported at attach (`nvidiaGpu`/`amdGpu`).
 *   - `GET /v1/machines` — the org's machines; the dialed-in BYO boxes (folded in by
 *     the backend as `provider:"byo"`) are the fleet's connected machines.
 *
 * It is also where a customer DOES the three connect actions: attach a BYO cluster
 * (`POST /v1/clusters`, validated + KMS-sealed server-side), connect a BYO box
 * (`hanzo gpu connect`), and — honestly "coming" — connect a cloud account (BYOC).
 *
 * Honest by construction: loading / empty ("no compute yet") / error render truthful
 * states (`BackendStateCard`), the attach form surfaces the real backend failure
 * (503 KMS-not-configured, 422 unreachable-kubeconfig), and no row is ever
 * fabricated — GPU/CPU facts the control plane doesn't expose render an em-dash.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Boxes, Cable, Check, ChevronRight, Copy, Cpu, HardDrive, Network, Plus, RefreshCw, Server, Trash2, Upload } from '@hanzogui/lucide-icons-2'

import { ApiError, PlatformApi, type Cluster } from '~/lib/api'
import { VisorApi, type VisorMachine } from '~/lib/api/visor'
import { MetricCard, HintButton } from '~/components/ui/Metric'
import {
  summarizeFleet,
  byoBoxes,
  isByoCluster,
  clusterGpuTotal,
  clusterNodeTotal,
  describeAttachError,
  CONNECT_SNIPPET,
} from './kubernetes/logic'
import { BackendStateCard, CopyButton, DataTable, EmptyState, FieldRow, FieldSwitch, FieldText, FieldTextArea, PageHeader, StatusTag, classifyRead, type BackendState, type Column } from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

/** A monospace, copy-selectable one-line command block. */
function Snippet({ code }: { code: string }) {
  return (
    <XStack items="center" gap="$2" bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$3" px="$3" py="$2">
      <Text flex={1} fontSize="$2" color="$color12" numberOfLines={1} selectable style={{ fontFamily: 'monospace' }}>
        {code}
      </Text>
      <CopyButton value={code} label="Copy command" id="kubeconfig" />
    </XStack>
  )
}

/** Kind pill — managed (pools) vs attached BYO. */
function KindTag({ c }: { c: Cluster }) {
  const byo = isByoCluster(c)
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg={byo ? '$color4' : '$color3'} color="$color11">
      {byo ? 'BYO' : 'Managed'}
    </Text>
  )
}

/** Attach an existing cluster by kubeconfig → `POST /v1/clusters`. */
function AttachClusterForm({ onAttached, onClose }: { onAttached: (c: Cluster) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [kubeconfig, setKubeconfig] = useState('')
  const [provider, setProvider] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ReturnType<typeof describeAttachError> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSubmit = name.trim() !== '' && kubeconfig.trim() !== '' && !busy

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const cluster = await PlatformApi.attachCluster({
        name: name.trim(),
        kubeconfig,
        provider: provider.trim() || undefined,
        default: isDefault,
      })
      onAttached(cluster)
      onClose()
    } catch (e) {
      setErr(describeAttachError(e))
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      try {
        setKubeconfig(await f.text())
      } catch {
        /* unreadable file — the user can still paste */
      }
    }
    e.target.value = '' // allow re-selecting the same file
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" width="100%" maxWidth={720}>
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">Register a cluster</Text>
        <Text fontSize="$2" color="$color10" cursor="pointer" onPress={onClose}>Cancel</Text>
      </XStack>
      <Text fontSize="$2" color="$color11">
        Bring an existing Kubernetes cluster into your fleet. We validate it by reaching its nodes, read its GPU inventory,
        and seal the kubeconfig in your KMS — it is never stored or shown again.
      </Text>

      <FieldRow label="Name">
        <FieldText value={name} onChange={setName} disabled={busy} placeholder="lab-rig" />
      </FieldRow>
      <FieldRow label="Provider (optional)">
        <FieldText value={provider} onChange={setProvider} disabled={busy} placeholder="byo" />
      </FieldRow>
      <FieldRow label="Kubeconfig">
        <YStack gap="$2">
          <FieldTextArea value={kubeconfig} onChange={setKubeconfig} disabled={busy} rows={8} />
          <XStack gap="$2" items="center">
            <input ref={fileRef} type="file" accept=".yaml,.yml,.conf,.txt,text/*" style={{ display: 'none' }} onChange={onFile} />
            <Button size="$2" icon={<Upload size={14} />} disabled={busy} onPress={() => fileRef.current?.click()}>
              Upload file
            </Button>
            <Text fontSize="$1" color="$color10">
              {kubeconfig ? `${kubeconfig.length.toLocaleString()} chars` : 'paste it, or upload a kubeconfig file'}
            </Text>
          </XStack>
        </YStack>
      </FieldRow>
      <FieldRow label="Make default">
        <FieldSwitch checked={isDefault} onChange={setIsDefault} disabled={busy} />
      </FieldRow>

      {err ? (
        <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$3" gap="$1">
          <Text fontSize="$3" fontWeight="700" color="$color12">{err.title}</Text>
          <Text fontSize="$2" color="$color11">{err.detail}</Text>
        </Card>
      ) : null}

      <XStack gap="$2">
        <Button theme="light" icon={<Plus size={16} />} disabled={!canSubmit} onPress={() => void submit()}>
          {busy ? 'Attaching…' : 'Attach cluster'}
        </Button>
      </XStack>
    </Card>
  )
}

/** The three ways to add compute — attach a cluster, connect a box, connect a cloud account. */
function ConnectOptions({ open, onToggle, onAttached }: { open: boolean; onToggle: () => void; onAttached: (c: Cluster) => void }) {
  return (
    <YStack gap="$3">
      <Text fontSize="$5" fontWeight="800" color="$color12">Add compute</Text>
      <XStack gap="$3" flexWrap="wrap" items="stretch">
        {/* BYO cluster — the attach form */}
        <Card flex={1} minW={260} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$2"><Network size={18} /><Text fontSize="$4" fontWeight="700">Bring a cluster</Text></XStack>
          <Text fontSize="$2" color="$color11" flex={1}>
            Attach any existing Kubernetes cluster with its kubeconfig. Validated on attach, sealed in your KMS, and scheduled
            like a managed cluster.
          </Text>
          <Button theme="light" icon={<Plus size={15} />} onPress={onToggle}>{open ? 'Close form' : 'Register cluster'}</Button>
        </Card>

        {/* BYO box — the CLI snippet */}
        <Card flex={1} minW={260} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$2"><Server size={18} /><Text fontSize="$4" fontWeight="700">Connect a box</Text></XStack>
          <Text fontSize="$2" color="$color11">
            Dial a GPU box or bare-metal machine into your fleet from the Hanzo CLI. It shows up here and in Machines / GPUs.
          </Text>
          <Snippet code={CONNECT_SNIPPET} />
          <Text fontSize="$1" color="$color10">Auto-links when you sign in on Hanzo Desktop.</Text>
        </Card>

        {/* BYOC cloud account — honest "coming" */}
        <Card flex={1} minW={260} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" justify="space-between" gap="$2">
            <XStack items="center" gap="$2"><Cable size={18} /><Text fontSize="$4" fontWeight="700">Connect a cloud account</Text></XStack>
            <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">Soon</Text>
          </XStack>
          <Text fontSize="$2" color="$color11" flex={1}>
            Bring your AWS, GCP, Azure, or DigitalOcean account and provision managed clusters directly in it.
          </Text>
          <HintButton icon={<Plus size={15} />} disabled hint="Cloud-account (BYOC) connect is coming — bring your AWS/GCP/Azure/DO account here.">
            Connect account
          </HintButton>
        </Card>
      </XStack>

      {open ? <AttachClusterForm onAttached={onAttached} onClose={onToggle} /> : null}
    </YStack>
  )
}

export function KubernetesModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [clusters, setClusters] = useState<Async<Cluster[]>>({ phase: 'loading' })
  const [machines, setMachines] = useState<VisorMachine[]>([])
  const [showAttach, setShowAttach] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback((opts?: { background?: boolean }) => {
    // A background reload (after a mutation) keeps the current fleet on screen while
    // it refetches — no blank/flash. The initial load + explicit Refresh show the spinner.
    if (!opts?.background) setClusters({ phase: 'loading' })
    PlatformApi.listClusters()
      .then((data) => setClusters({ phase: 'ready', data }))
      .catch((e) => {
        // A 402 on a READ is "nothing provisioned yet" (honest empty), not a wall.
        const s = classifyRead(e)
        setClusters(s ? { phase: 'error', error: s } : { phase: 'ready', data: [] })
      })
    // Machines are the fleet's connected BYO boxes — best-effort enrichment that
    // never blocks the clusters view (an upstream blip just shows no boxes).
    VisorApi.machines().then(setMachines).catch(() => setMachines([]))
  }, [])

  useEffect(() => load(), [load])

  const rows = clusters.phase === 'ready' ? clusters.data : []
  const boxes = useMemo(() => byoBoxes(machines), [machines])
  const summary = useMemo(() => summarizeFleet(rows, machines), [rows, machines])
  const ready = clusters.phase === 'ready'
  const empty = ready && rows.length === 0 && boxes.length === 0

  const onAttached = useCallback(
    (c: Cluster) => {
      // Show the attached cluster immediately (optimistic), then reconcile from the API.
      setClusters((prev) =>
        prev.phase === 'ready' ? { phase: 'ready', data: [c, ...prev.data.filter((x) => x.name !== c.name)] } : prev,
      )
      setNotice(`Attached "${c.name}".`)
      load({ background: true })
    },
    [load],
  )

  const detach = (c: Cluster) => {
    setNotice(null)
    if (typeof window !== 'undefined' && !window.confirm(`Detach BYO cluster "${c.name}"? Workloads stop scheduling on it — your cluster itself is untouched.`)) return
    PlatformApi.detachCluster(c.name)
      .then(() => {
        setNotice(`Detached "${c.name}".`)
        load({ background: true })
      })
      .catch((e) => setNotice(e instanceof ApiError ? e.message : 'Failed to detach cluster'))
  }

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
    { key: 'kind', header: 'Kind', width: 96, render: (c) => <KindTag c={c} /> },
    {
      key: 'gpus',
      header: 'GPUs',
      width: 120,
      render: (c) => {
        const total = clusterGpuTotal(c)
        return total > 0 ? (
          <YStack>
            <Text fontSize="$3" color="$color12">{total}</Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>{c.nvidiaGpu ?? 0} NV · {c.amdGpu ?? 0} AMD</Text>
          </YStack>
        ) : (
          <Text fontSize="$3" color="$color10">—</Text>
        )
      },
    },
    { key: 'nodes', header: 'Nodes', width: 80, render: (c) => <Text fontSize="$3" color="$color11">{clusterNodeTotal(c) || '—'}</Text> },
    { key: 'region', header: 'Region', width: 100, render: (c) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{c.region || '—'}</Text> },
    { key: 'created', header: 'Created', width: 110, render: (c) => <Text fontSize="$3" color="$color11">{fmtDate(c.createdAt)}</Text> },
    {
      key: 'actions',
      header: '',
      width: 190,
      render: (c) => (
        <XStack justify="flex-end" flex={1} gap="$2" items="center">
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => router.push(`/containers?cluster=${encodeURIComponent(c.name)}`)}>
            Workloads
          </Button>
          {isByoCluster(c) ? (
            <Button size="$2" chromeless theme="red" icon={<Trash2 size={14} />} onPress={() => detach(c)} aria-label={`Detach ${c.name}`} />
          ) : null}
        </XStack>
      ),
    },
  ]

  const boxColumns: Column<VisorMachine>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <YStack>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{m.name || m.id}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{m.region || 'on-prem'}</Text>
        </YStack>
      ),
    },
    { key: 'status', header: 'Status', width: 110, render: (m) => <StatusTag status={m.status} /> },
    { key: 'gpu', header: 'Accelerators', width: 200, render: (m) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{m.gpu || '—'}</Text> },
    { key: 'os', header: 'OS', width: 120, render: (m) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{m.os || '—'}</Text> },
    { key: 'created', header: 'Connected', width: 120, render: (m) => <Text fontSize="$3" color="$color11">{fmtDate(m.createdAt)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title="Kubernetes"
        subtitle="Your unified compute fleet — managed Hanzo K8S, your own attached clusters, and connected machines."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button icon={<RefreshCw size={16} />} onPress={() => load()}>Refresh</Button>
            <Button theme="light" icon={<Plus size={16} />} onPress={() => setShowAttach((v) => !v)}>Register cluster</Button>
          </XStack>
        }
      />

      {/* Fleet at a glance — real counts across clusters + connected boxes; honest "—" until ready. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Network size={15} />} label="Clusters" value={ready ? String(summary.clusters) : '—'} caption={ready ? `${summary.managedClusters} managed · ${summary.byoClusters} BYO` : 'managed + BYO'} />
        <MetricCard icon={<Activity size={15} />} label="Online" value={ready ? String(summary.online) : '—'} caption={ready ? `${summary.clusters - summary.online} other` : 'running + attached'} />
        <MetricCard icon={<Server size={15} />} label="Nodes" value={ready ? summary.nodes.toLocaleString() : '—'} caption="across all clusters" />
        <MetricCard icon={<Cpu size={15} />} label="GPUs" value={ready && summary.gpus ? summary.gpus.toLocaleString() : '—'} caption={ready && summary.gpus ? `${summary.nvidia} NVIDIA · ${summary.amd} AMD` : 'nvidia + amd'} />
        <MetricCard icon={<HardDrive size={15} />} label="Connected boxes" value={ready ? String(summary.boxes) : '—'} caption="hanzo gpu connect" />
      </XStack>

      <ConnectOptions open={showAttach} onToggle={() => setShowAttach((v) => !v)} onAttached={onAttached} />

      {notice ? <Text fontSize="$2" color="$color11">{notice}</Text> : null}

      {clusters.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center"><Spinner /><Text color="$color11">Loading your fleet…</Text></XStack>
      ) : clusters.phase === 'error' ? (
        <BackendStateCard state={clusters.error} onRetry={() => load()} />
      ) : empty ? (
        <EmptyState
          icon={Boxes}
          title="No compute yet"
          description="Your workloads run on shared Hanzo Cloud until you add your own. Attach a cluster, connect a GPU box, or provision a dedicated cluster — it all shows up here."
          bullets={[
            'Bring any Kubernetes cluster with its kubeconfig — validated and sealed in your KMS.',
            'Dial a GPU box or bare-metal machine in from the Hanzo CLI (hanzo gpu connect).',
            'Provision a fresh dedicated DOKS cluster from Clusters.',
          ]}
          primary={{ label: 'Register a cluster', onPress: () => setShowAttach(true) }}
          secondary={{ label: 'Provision a cluster', onPress: () => router.push('/clusters') }}
        />
      ) : (
        <YStack gap="$4">
          {rows.length ? (
            <YStack gap="$2">
              <Text fontSize="$5" fontWeight="800" color="$color12">Clusters</Text>
              <DataTable columns={columns} rows={rows} rowKey={(c) => c.doksClusterId || c.id || c.name} empty="No clusters yet." />
            </YStack>
          ) : null}

          {boxes.length ? (
            <YStack gap="$2">
              <XStack items="center" justify="space-between">
                <Text fontSize="$5" fontWeight="800" color="$color12">Connected machines</Text>
                <Button size="$2" chromeless iconAfter={<ChevronRight size={14} />} onPress={() => router.push('/machines')}>All machines</Button>
              </XStack>
              <Text fontSize="$1" color="$color10">Bring-your-own boxes dialed in via hanzo gpu connect. Full inventory and per-GPU detail live in Machines and GPUs.</Text>
              <DataTable columns={boxColumns} rows={boxes} rowKey={(m) => m.id} empty="No connected machines." />
            </YStack>
          ) : null}
        </YStack>
      )}
    </>
  )
}
