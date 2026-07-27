'use client'

/**
 * Training — the fine-tuning / training console over the live cloud mlsvc
 * (`/v1/train/jobs`, `/v1/train/experiments`, `/v1/ml/models`) through the console's
 * OWN `/training` proxy (session cookie + org, server-side). Tabs are REAL
 * sub-routes (the registry `:tab` pattern): Jobs / Datasets / Checkpoints / Models
 * / Configs.
 *
 * Every metric/row is a real backend value or an honest state — stat cards read
 * the real job list (an unexposed metric shows `—`, never a fabricated number); the
 * training-loss chart plots a REAL experiment series or renders nothing; a
 * 404/not-wired read shows a truthful BackendStateCard, never lorem rows. Creating
 * a job is billing-gated (402) and surfaced honestly by the New-job panel.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Clock, CreditCard, Database, Plus, RefreshCw, Sparkles, Target, Trash2 } from '@hanzogui/lucide-icons-2'

import { TrainApi, type TrainJob, type TrainExperiment, type MlModel } from '~/lib/api/train'
import { usd } from '~/lib/api/compute'
import { currentOrg } from '~/lib/org-scope'
import { loadConfigs, removeConfig, onConfigsChange, type TrainingConfig } from '~/lib/training-configs'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { MetricCard, UtilBar, SERIES } from '~/components/ui/Metric'
import { Panel } from '~/components/ui/Panel'
import { LineChart, type ChartPoint } from '~/components/ui/Charts'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { NewTrainingPanel } from './training/NewTrainingPanel'
import { InteractiveTraining } from './training/InteractiveTraining'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const ACTIVE = new Set(['training', 'running', 'queued', 'pending'])
const DONE = new Set(['completed', 'succeeded'])
const FAIL = new Set(['failed', 'cancelled'])

const fmtDate = (v?: string) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}
const fmtNum = (n?: number, digits = 3) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—')

// ── Jobs tab ─────────────────────────────────────────────────────────────────

function JobsTable({ jobs }: { jobs: TrainJob[] }) {
  const columns: Column<TrainJob>[] = [
    {
      key: 'job',
      header: 'Job',
      render: (j) => (
        <YStack>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{j.name || j.id}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{j.id}</Text>
        </YStack>
      ),
    },
    {
      key: 'base',
      header: 'Base model',
      width: 180,
      render: (j) => (
        <YStack>
          <Text fontSize="$3" color="$color11" numberOfLines={1}>{j.baseModel || '—'}</Text>
          {j.version ? <Text fontSize="$1" color="$color10">{j.version}</Text> : null}
        </YStack>
      ),
    },
    { key: 'type', header: 'Type', width: 110, render: (j) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{j.type || '—'}</Text> },
    {
      key: 'dataset',
      header: 'Dataset',
      width: 160,
      render: (j) => (
        <YStack>
          <Text fontSize="$3" color="$color11" numberOfLines={1}>{j.dataset || '—'}</Text>
          {typeof j.datasetSamples === 'number' ? <Text fontSize="$1" color="$color10">{j.datasetSamples.toLocaleString()} samples</Text> : null}
        </YStack>
      ),
    },
    { key: 'status', header: 'Status', width: 110, render: (j) => <StatusTag status={j.status} /> },
    {
      key: 'progress',
      header: 'Progress',
      width: 130,
      render: (j) =>
        typeof j.progress === 'number' ? (
          <XStack gap="$2" items="center">
            <UtilBar value={j.progress} width={72} color={SERIES[0]} />
            <Text fontSize="$2" color="$color11">{Math.round(j.progress)}%</Text>
          </XStack>
        ) : (
          <Text fontSize="$3" color="$color10">—</Text>
        ),
    },
    { key: 'gpu', header: 'GPU', width: 110, render: (j) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{j.gpu ? `${j.gpu}${j.gpuCount && j.gpuCount > 1 ? ` ×${j.gpuCount}` : ''}` : '—'}</Text> },
    { key: 'cost', header: 'Cost', width: 90, render: (j) => <Text fontSize="$3" color="$color11">{typeof j.costCents === 'number' ? usd(j.costCents) : '—'}</Text> },
  ]
  return <DataTable columns={columns} rows={jobs} rowKey={(j) => j.id} empty="No training jobs yet. Start one above." />
}

/** Build a real training-loss series from the richest experiment (train loss, else val). */
function lossSeries(experiments: TrainExperiment[]): { name: string; points: ChartPoint[] } | null {
  const withMetrics = experiments.filter((e) => e.metrics.length >= 2)
  if (!withMetrics.length) return null
  const best = withMetrics.sort((a, b) => b.metrics.length - a.metrics.length)[0]
  const points = best.metrics
    .map((m) => ({ label: String(m.step), value: m.loss ?? m.valLoss ?? NaN }))
    .filter((p) => Number.isFinite(p.value))
  if (points.length < 2) return null
  return { name: best.name || best.id, points }
}

// ── Module ─────────────────────────────────────────────────────────────────

export function FinetuningModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const org = currentOrg()
  const tab = productSubpageSlug('finetuning', params.tab)

  const [jobs, setJobs] = useState<Async<TrainJob[]>>({ phase: 'loading' })
  const [experiments, setExperiments] = useState<Async<TrainExperiment[]>>({ phase: 'loading' })
  const [models, setModels] = useState<Async<MlModel[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)
  const [configs, setConfigs] = useState<TrainingConfig[]>([])

  const load = useCallback(() => {
    setJobs({ phase: 'loading' })
    setExperiments({ phase: 'loading' })
    setModels({ phase: 'loading' })
    TrainApi.listJobs().then((data) => setJobs({ phase: 'ready', data })).catch((e) => setJobs({ phase: 'error', error: classifyBackend(e) }))
    TrainApi.experiments().then((data) => setExperiments({ phase: 'ready', data })).catch((e) => setExperiments({ phase: 'error', error: classifyBackend(e) }))
    TrainApi.models().then((data) => setModels({ phase: 'ready', data })).catch((e) => setModels({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => load(), [load])

  useEffect(() => {
    setConfigs(loadConfigs(org))
    return onConfigsChange(() => setConfigs(loadConfigs(org)))
  }, [org])

  const jobRows = jobs.phase === 'ready' ? jobs.data : []
  const stats = useMemo(() => {
    const active = jobRows.filter((j) => ACTIVE.has((j.status || '').toLowerCase())).length
    const done = jobRows.filter((j) => DONE.has((j.status || '').toLowerCase())).length
    const failed = jobRows.filter((j) => FAIL.has((j.status || '').toLowerCase())).length
    const finished = done + failed
    const spend = jobRows.reduce((a, j) => a + (j.costCents ?? 0), 0)
    return {
      active,
      spend: jobRows.some((j) => typeof j.costCents === 'number') ? spend : null,
      successRate: finished ? Math.round((done / finished) * 100) : null,
    }
  }, [jobRows])

  const loss = useMemo(() => (experiments.phase === 'ready' ? lossSeries(experiments.data) : null), [experiments])
  const expRows = experiments.phase === 'ready' ? experiments.data : []

  const go = (id: string) => router.push(`/finetuning${id ? `/${id}` : ''}`)

  return (
    <>
      <PageHeader
        title="Training"
        subtitle="Fine-tune and train models on your own data."
        actions={
          <XStack gap="$2">
            <Button icon={<RefreshCw size={16} />} onPress={load}>Refresh</Button>
            <Button theme="light" icon={<Plus size={16} />} onPress={() => setCreating((v) => !v)}>New training job</Button>
          </XStack>
        }
      />

      {/* Stat cards — real job-derived counts; honest "—" where mlsvc doesn't expose a metric. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Activity size={15} />} label="Active jobs" value={jobs.phase === 'ready' ? String(stats.active) : '—'} caption={jobs.phase === 'ready' ? `${jobRows.length} total` : 'quota not exposed'} />
        <MetricCard icon={<Clock size={15} />} label="GPU hours" value="—" caption="metered per GPU-hour" />
        <MetricCard icon={<CreditCard size={15} />} label="Training spend" value={stats.spend == null ? '—' : usd(stats.spend)} caption="across jobs" />
        <MetricCard icon={<Target size={15} />} label="Success rate" value={stats.successRate == null ? '—' : `${stats.successRate}%`} caption="completed / finished" />
      </XStack>

      <SubNav id="finetuning" />

      {tab === '' ? (
        <>
          {creating ? <NewTrainingPanel org={org} onCreated={load} onClose={() => setCreating(false)} /> : null}
          {jobs.phase === 'error' ? (
            <BackendStateCard state={jobs.error} onRetry={load} hint="Training jobs are read from the cloud mlsvc (/v1/train/jobs) with your session." />
          ) : (
            <JobsTable jobs={jobRows} />
          )}

          <XStack gap="$3" flexWrap="wrap" items="flex-start">
            <Panel title="Training loss" minW={360}>
              {loss ? (
                <YStack gap="$1">
                  <Text fontSize="$2" color="$color10" numberOfLines={1}>{loss.name}</Text>
                  <LineChart data={loss.points} formatValue={(v) => v.toFixed(3)} />
                </YStack>
              ) : (
                <YStack height={140} items="center" justify="center" borderWidth={1} borderColor="$borderColor" borderStyle="dashed" rounded="$3">
                  <Text fontSize="$2" color="$color10" text="center" maxW={320}>
                    {experiments.phase === 'error' ? 'Experiment metrics unavailable right now.' : 'A loss curve appears here once a run reports metrics.'}
                  </Text>
                </YStack>
              )}
            </Panel>

            <Panel title="Recent checkpoints" minW={320}>
              {expRows.length ? (
                <YStack gap="$2">
                  {expRows.slice(0, 5).map((e) => (
                    <XStack key={e.id} justify="space-between" items="center" py="$1" borderBottomWidth={1} borderColor="$borderColor">
                      <YStack flex={1} minW={120}>
                        <Text fontSize="$3" color="$color12" numberOfLines={1}>{e.name || e.id}</Text>
                        <Text fontSize="$1" color="$color10">{fmtDate(e.createdAt)}</Text>
                      </YStack>
                      <Text fontSize="$2" color="$color11">val {fmtNum(e.finalValLoss)} · ppl {fmtNum(e.finalPpl, 2)} · acc {typeof e.finalAcc === 'number' ? `${Math.round(e.finalAcc * (e.finalAcc <= 1 ? 100 : 1))}%` : '—'}</Text>
                    </XStack>
                  ))}
                </YStack>
              ) : (
                <Text fontSize="$2" color="$color10">No checkpoints yet.</Text>
              )}
            </Panel>
          </XStack>
        </>
      ) : tab === 'interactive' ? (
        <InteractiveTraining />
      ) : tab === 'datasets' ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={620}>
          <XStack gap="$2" items="center"><Database size={18} /><Text fontSize="$5" fontWeight="700">Datasets</Text></XStack>
          <Text fontSize="$3" color="$color11">
            Point a training job at a HuggingFace dataset id or one of your Stores / datasets. Dataset
            management (upload, versioning) lives in the Datasets product.
          </Text>
          <XStack><Button theme="light" onPress={() => router.push('/datasets')}>Open Datasets</Button></XStack>
        </Card>
      ) : tab === 'checkpoints' ? (
        experiments.phase === 'error' ? (
          <BackendStateCard state={experiments.error} onRetry={load} hint="Experiments + metrics come from the cloud mlsvc (/v1/train/experiments)." />
        ) : (
          <DataTable
            columns={[
              { key: 'name', header: 'Experiment', render: (e: TrainExperiment) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{e.name || e.id}</Text> },
              { key: 'job', header: 'Job', width: 160, render: (e: TrainExperiment) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{e.jobId || '—'}</Text> },
              { key: 'val', header: 'val_loss', width: 100, render: (e: TrainExperiment) => <Text fontSize="$3" color="$color11">{fmtNum(e.finalValLoss)}</Text> },
              { key: 'ppl', header: 'ppl', width: 90, render: (e: TrainExperiment) => <Text fontSize="$3" color="$color11">{fmtNum(e.finalPpl, 2)}</Text> },
              { key: 'acc', header: 'acc', width: 90, render: (e: TrainExperiment) => <Text fontSize="$3" color="$color11">{typeof e.finalAcc === 'number' ? `${Math.round(e.finalAcc * (e.finalAcc <= 1 ? 100 : 1))}%` : '—'}</Text> },
              { key: 'created', header: 'Created', width: 110, render: (e: TrainExperiment) => <Text fontSize="$3" color="$color11">{fmtDate(e.createdAt)}</Text> },
            ]}
            rows={expRows}
            rowKey={(e) => e.id}
            empty="No checkpoints reported yet."
          />
        )
      ) : tab === 'models' ? (
        models.phase === 'error' ? (
          <BackendStateCard state={models.error} onRetry={load} hint="Your trained/registered models come from the cloud mlsvc (/v1/ml/models)." />
        ) : (
          <DataTable
            columns={[
              { key: 'name', header: 'Model', render: (m: MlModel) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{m.name || m.id}</Text> },
              { key: 'base', header: 'Base model', width: 200, render: (m: MlModel) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{m.baseModel || '—'}</Text> },
              { key: 'params', header: 'Params', width: 100, render: (m: MlModel) => <Text fontSize="$3" color="$color11">{m.params || '—'}</Text> },
              { key: 'status', header: 'Status', width: 110, render: (m: MlModel) => <StatusTag status={m.status ?? 'unknown'} /> },
              { key: 'created', header: 'Created', width: 110, render: (m: MlModel) => <Text fontSize="$3" color="$color11">{fmtDate(m.createdAt)}</Text> },
            ]}
            rows={models.phase === 'ready' ? models.data : []}
            loading={models.phase === 'loading'}
            rowKey={(m) => m.id}
            empty="No trained models yet — start a job to produce one."
          />
        )
      ) : (
        // Configs — the user's client-side saved presets.
        configs.length ? (
          <DataTable
            columns={[
              { key: 'name', header: 'Config', render: (c: TrainingConfig) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{c.name}</Text> },
              { key: 'base', header: 'Base model', width: 180, render: (c: TrainingConfig) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{c.baseModel}</Text> },
              { key: 'type', header: 'Type', width: 110, render: (c: TrainingConfig) => <Text fontSize="$3" color="$color11">{c.type}</Text> },
              { key: 'gpu', header: 'GPU', width: 110, render: (c: TrainingConfig) => <Text fontSize="$3" color="$color11">{c.gpu}{c.gpuCount > 1 ? ` ×${c.gpuCount}` : ''}</Text> },
              { key: 'created', header: 'Saved', width: 110, render: (c: TrainingConfig) => <Text fontSize="$3" color="$color11">{fmtDate(c.createdAt)}</Text> },
              { key: 'actions', header: '', width: 90, render: (c: TrainingConfig) => (
                <XStack justify="flex-end" flex={1}>
                  <Button size="$2" chromeless icon={<Trash2 size={15} />} onPress={() => setConfigs(removeConfig(org, c.id))} />
                </XStack>
              ) },
            ]}
            rows={configs}
            rowKey={(c) => c.id}
            empty="No saved configs."
          />
        ) : (
          <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={560}>
            <XStack gap="$2" items="center"><Sparkles size={18} /><Text fontSize="$5" fontWeight="700">No saved configs</Text></XStack>
            <Text fontSize="$3" color="$color11">Build a job in the Jobs tab and choose “Save as config” to store its settings here for reuse.</Text>
          </Card>
        )
      )}
    </>
  )
}
