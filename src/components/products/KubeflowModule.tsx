'use client'

/**
 * ML Pipelines (Kubeflow) — the read-only orchestration + control-plane view over
 * the live cloud mlsvc bridge (hanzoai/cloud `clients/ml`), which fronts the
 * Kubeflow-family CRDs as REST through the console's OWN `/training` proxy.
 *
 * This is the Kubeflow *orchestration* lens (distinct from Fine-tuning, which is
 * the "train a model on my data" wizard): a real control-plane health strip
 * (`GET /v1/train/health` — which Kubeflow operators/CRDs are actually served),
 * then the two orchestration objects the bridge exposes —
 *   - Pipelines  = Katib Experiments (`GET /v1/train/experiments`)
 *   - Runs       = trainer TrainJobs  (`GET /v1/train/jobs`)
 * both fetched via the shared `TrainApi` (one client, no duplication).
 *
 * Honest by construction: EVERY row is a real backend object. A load failure
 * renders a truthful `BackendStateCard` (503 not-initialized · 404 not-routed ·
 * 401/403 session/access) instead of placeholder rows; a reachable-but-empty
 * plane renders an honest empty state. Nothing is fabricated — the console has
 * no Kubeflow Notebook/Pipeline-CRD surface, so none is invented here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Blocks, Play, RefreshCw, Workflow } from '@hanzogui/lucide-icons-2'

import { TrainApi, type TrainExperiment, type TrainJob } from '~/lib/api'
import { KubeflowApi, KUBEFLOW_OPERATORS, type KubeflowControlPlane } from '~/lib/api/kubeflow'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const TABS = [
  { id: 'pipelines', label: 'Pipelines', icon: Workflow },
  { id: 'runs', label: 'Runs', icon: Play },
] as const
type TabId = (typeof TABS)[number]['id']

const DASH = '—'
const fmtDate = (v?: string) => {
  if (!v) return DASH
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}
const fmtNum = (n?: number, digits = 3) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : DASH)

// ── Control-plane strip ───────────────────────────────────────────────────────
// A compact, honest one-liner: whether the Kubeflow control plane is reporting,
// and which operators (Trainer/Katib) are live. The lists below carry the
// primary state, so this stays understated — never a big error card.
function ControlPlaneStrip({ cp }: { cp: Async<KubeflowControlPlane> }) {
  if (cp.phase !== 'ready') return null
  const { healthy, k8s, error } = cp.data
  const reporting = k8s
  const dot = healthy ? '$green10' : reporting ? '$yellow10' : '$color8'
  const label = healthy
    ? 'Kubeflow control plane · connected'
    : reporting
      ? 'Kubeflow control plane · degraded'
      : 'Kubeflow control plane · not reporting'

  return (
    <XStack
      items="center"
      gap="$3"
      px="$3"
      py="$2"
      rounded="$4"
      bg="$color2"
      borderWidth={1}
      borderColor="$borderColor"
      flexWrap="wrap"
    >
      <XStack items="center" gap="$2">
        <YStack width={8} height={8} rounded="$10" bg={dot} />
        <Text fontSize="$2" color="$color11">
          {label}
        </Text>
      </XStack>
      {reporting ? (
        <XStack items="center" gap="$2" flexWrap="wrap">
          {KUBEFLOW_OPERATORS.map((op) => {
            const up = cp.data.crds[op.crd] === true
            return (
              <XStack key={op.crd} items="center" gap="$1.5">
                <YStack width={6} height={6} rounded="$10" bg={up ? '$green10' : '$color8'} />
                <Text fontSize="$1" color="$color10">
                  {op.label}
                </Text>
                <Text fontSize="$1" color="$color9" style={{ fontFamily: 'monospace' }}>
                  {op.crd}
                </Text>
              </XStack>
            )
          })}
        </XStack>
      ) : error ? (
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {error}
        </Text>
      ) : null}
    </XStack>
  )
}

// ── Column sets ───────────────────────────────────────────────────────────────

const pipelineColumns: Column<TrainExperiment>[] = [
  {
    key: 'name',
    header: 'Pipeline',
    render: (e) => (
      <YStack minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {e.name || e.id}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1} style={{ fontFamily: 'monospace' }}>
          {e.id}
        </Text>
      </YStack>
    ),
  },
  { key: 'job', header: 'Job', width: 160, render: (e) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{e.jobId || DASH}</Text> },
  { key: 'trials', header: 'Trials', width: 90, render: (e) => <Text fontSize="$3" color="$color11">{e.metrics.length || DASH}</Text> },
  { key: 'val', header: 'val_loss', width: 100, render: (e) => <Text fontSize="$3" color="$color11">{fmtNum(e.finalValLoss)}</Text> },
  { key: 'status', header: 'Status', width: 110, render: (e) => <StatusTag status={e.status ?? 'unknown'} /> },
  { key: 'created', header: 'Created', width: 170, render: (e) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{fmtDate(e.createdAt)}</Text> },
]

const runColumns: Column<TrainJob>[] = [
  {
    key: 'name',
    header: 'Run',
    render: (j) => (
      <YStack minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {j.name || j.id}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1} style={{ fontFamily: 'monospace' }}>
          {j.id}
        </Text>
      </YStack>
    ),
  },
  { key: 'base', header: 'Base model', width: 180, render: (j) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{j.baseModel || DASH}</Text> },
  { key: 'type', header: 'Type', width: 110, render: (j) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{j.type || DASH}</Text> },
  { key: 'gpu', header: 'GPU', width: 120, render: (j) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{j.gpu ? `${j.gpu}${j.gpuCount && j.gpuCount > 1 ? ` ×${j.gpuCount}` : ''}` : DASH}</Text> },
  { key: 'status', header: 'Status', width: 110, render: (j) => <StatusTag status={j.status} /> },
  { key: 'created', header: 'Created', width: 170, render: (j) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{fmtDate(j.createdAt)}</Text> },
]

// ── Module ────────────────────────────────────────────────────────────────────

export function KubeflowModule(_props: { params: Record<string, string> }) {
  const [cp, setCp] = useState<Async<KubeflowControlPlane>>({ phase: 'loading' })
  const [pipelines, setPipelines] = useState<Async<TrainExperiment[]>>({ phase: 'loading' })
  const [runs, setRuns] = useState<Async<TrainJob[]>>({ phase: 'loading' })
  const [tab, setTab] = useState<TabId>('pipelines')

  const load = useCallback(() => {
    setCp({ phase: 'loading' })
    setPipelines({ phase: 'loading' })
    setRuns({ phase: 'loading' })
    // controlPlane() never throws — the .catch is a belt-and-suspenders no-op.
    KubeflowApi.controlPlane()
      .then((data) => setCp({ phase: 'ready', data }))
      .catch((e) => setCp({ phase: 'ready', data: { healthy: false, k8s: false, crds: {}, error: e instanceof Error ? e.message : String(e) } }))
    TrainApi.experiments()
      .then((data) => setPipelines({ phase: 'ready', data }))
      .catch((e) => setPipelines({ phase: 'error', error: classifyBackend(e) }))
    TrainApi.listJobs()
      .then((data) => setRuns({ phase: 'ready', data }))
      .catch((e) => setRuns({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => load(), [load])

  const count = useCallback(
    (t: TabId): number | null => {
      const src = t === 'pipelines' ? pipelines : runs
      return src.phase === 'ready' ? src.data.length : null
    },
    [pipelines, runs],
  )

  const active = tab === 'pipelines' ? pipelines : runs
  const hint = useMemo(
    () =>
      tab === 'pipelines'
        ? 'Pipelines are Katib Experiments from the Kubeflow bridge (GET /v1/train/experiments).'
        : 'Runs are trainer TrainJobs from the Kubeflow bridge (GET /v1/train/jobs).',
    [tab],
  )

  return (
    <>
      <PageHeader
        title="ML Pipelines"
        subtitle="Orchestrated training and evaluation pipelines on Kubeflow — Katib experiments and trainer runs."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      <ControlPlaneStrip cp={cp} />

      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => {
          const n = count(t.id)
          const Icon = t.icon
          return (
            <Button
              key={t.id}
              size="$2"
              bg={t.id === tab ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              icon={<Icon size={14} />}
              onPress={() => setTab(t.id)}
            >
              {n === null ? t.label : `${t.label} · ${n}`}
            </Button>
          )
        })}
      </XStack>

      {active.phase === 'error' ? (
        <BackendStateCard state={active.error} onRetry={load} hint={hint} />
      ) : tab === 'pipelines' ? (
        <DataTable
          columns={pipelineColumns}
          rows={pipelines.phase === 'ready' ? pipelines.data : []}
          loading={pipelines.phase === 'loading'}
          rowKey={(e) => e.id}
          empty="No pipelines yet. Katib experiments you orchestrate appear here."
        />
      ) : (
        <DataTable
          columns={runColumns}
          rows={runs.phase === 'ready' ? runs.data : []}
          loading={runs.phase === 'loading'}
          rowKey={(j) => j.id}
          empty="No runs yet. Trainer TrainJobs appear here as they are submitted."
        />
      )}
    </>
  )
}
