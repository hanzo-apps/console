'use client'

/**
 * Training — the fine-tuning / training console over the cloud fine-tuning broker
 * (`/v1/ai/finetune/jobs`, `/v1/ml/models`) through the console's OWN `/training`
 * proxy (session cookie + org, server-side). Tabs are REAL sub-routes (the registry
 * `:tab` pattern): Jobs / Datasets / Models / Configs.
 *
 * Every metric/row is a real backend value or an honest state — stat cards read
 * the real job list (an unexposed metric shows `—`, never a fabricated number); a
 * 404/not-wired read shows a truthful BackendStateCard, never lorem rows. Creating
 * a job is billing-gated (402) and surfaced honestly by the New-job panel.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, Clock, CreditCard, Database, Plus, RefreshCw, Sparkles, Target, Trash2 } from '@hanzogui/lucide-icons-2'

import { TrainApi, type TrainJob, type MlModel } from '~/lib/api/train'
import { usd } from '~/lib/api/compute'
import { currentOrg } from '~/lib/org-scope'
import { loadConfigs, removeConfig, onConfigsChange, type TrainingConfig } from '~/lib/training-configs'
import { MetricCard, UtilBar, SERIES } from '~/components/ui/Metric'
import { NewTrainingPanel } from './training/NewTrainingPanel'
import { BackendStateCard, DataTable, PageHeader, StatusTag, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const ACTIVE = new Set(['training', 'running', 'queued', 'pending'])
const DONE = new Set(['completed', 'succeeded'])
const FAIL = new Set(['failed', 'cancelled'])

const fmtDate = (v?: string) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

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

// ── Module ─────────────────────────────────────────────────────────────────

export function FinetuningModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const org = currentOrg()
  const tab = productSubpageSlug('finetuning', params.tab)

  const [jobs, setJobs] = useState<Async<TrainJob[]>>({ phase: 'loading' })
  const [models, setModels] = useState<Async<MlModel[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)
  const [configs, setConfigs] = useState<TrainingConfig[]>([])

  const load = useCallback(() => {
    setJobs({ phase: 'loading' })
    setModels({ phase: 'loading' })
    TrainApi.listJobs().then((data) => setJobs({ phase: 'ready', data })).catch((e) => setJobs({ phase: 'error', error: classifyBackend(e) }))
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
            <BackendStateCard state={jobs.error} onRetry={load} hint="Training jobs are read from the cloud fine-tuning broker (/v1/ai/finetune/jobs) with your session." />
          ) : (
            <JobsTable jobs={jobRows} />
          )}
        </>
      ) : tab === 'datasets' ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={620}>
          <XStack gap="$2" items="center"><Database size={18} /><Text fontSize="$5" fontWeight="700">Datasets</Text></XStack>
          <Text fontSize="$3" color="$color11">
            Point a training job at a HuggingFace dataset id or one of your Stores / datasets. Dataset
            management (upload, versioning) lives in the Datasets product.
          </Text>
          <XStack><Button theme="light" onPress={() => router.push('/datasets')}>Open Datasets</Button></XStack>
        </Card>
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
