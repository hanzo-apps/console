'use client'

/**
 * Tasks — orchestrate, monitor, and debug durable workflows (a Temporal-style
 * console) over the hanzoai/tasks engine, through the console's OWN `/tasks` proxy
 * (mints a user Bearer server-side; org-scoped by the token). Tabs are REAL
 * sub-routes (the registry `:tab` pattern): Workflows / Schedules / Queues /
 * Workers / Activities. Selecting a workflow opens the detail panel.
 *
 * Every stat/row/chart is a real engine value or an honest state — stat cards
 * count REAL workflows (an unexposed metric is `—`); the throughput chart plots
 * REAL workflow starts (no telemetry stream is invented); the cluster-health rail
 * shows the engine's REAL status (tasksd is a single-node engine, not a 5-service
 * Temporal cluster, so it is labelled honestly). A 404/unreachable read shows a
 * truthful BackendStateCard — never fabricated workflows. The public tasks TLS
 * isn't live yet, so today most reads show that honest state until the in-cluster
 * engine is reachable.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, CheckCircle2, XCircle, PauseCircle, Timer, Zap, RefreshCw, ChevronRight } from '@hanzogui/lucide-icons-2'

import {
  TasksApi,
  type ClusterStatus,
  type Namespace,
  type WorkflowExecution,
  type Schedule,
  type TaskQueue,
  type Worker,
  type ActivityInfo,
} from '~/lib/api'
import { MetricCard } from '~/components/ui/Metric'
import { Panel } from '~/components/ui/Panel'
import { LineChart, BarRows, type ChartPoint } from '~/components/ui/Charts'
import { statusOf, statusStyle, type Bucket } from './tasks/status'
import { WorkflowDetailPanel } from './tasks/detail'
import { BackendStateCard, DataTable, FieldSelect, PageHeader, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const nsName = (n: Namespace): string => n.namespaceInfo?.name ?? ''
const fmt = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}
function duration(start?: string, end?: string): string {
  if (!start) return '—'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  if (Number.isNaN(s) || Number.isNaN(e)) return '—'
  const secs = Math.max(0, Math.floor((e - s) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${secs}s`
}

function StatusPill({ status }: { status: string }) {
  const { label, bg, color } = statusStyle(status)
  return <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg={bg as never} color={color as never}>{label}</Text>
}

/** Bucket real workflow start times into an hourly throughput series (last 12h). */
function throughput(workflows: WorkflowExecution[]): ChartPoint[] {
  const now = Date.now()
  const buckets = new Array(12).fill(0)
  for (const w of workflows) {
    if (!w.startTime) continue
    const t = new Date(w.startTime).getTime()
    if (Number.isNaN(t)) continue
    const hoursAgo = Math.floor((now - t) / 3_600_000)
    if (hoursAgo >= 0 && hoursAgo < 12) buckets[11 - hoursAgo] += 1
  }
  return buckets.map((v, i) => ({ label: `${11 - i}h`, value: v }))
}

// ── namespace data ──────────────────────────────────────────────────────────

type NsData = {
  workflows: Async<WorkflowExecution[]>
  schedules: Async<Schedule[]>
  queues: Async<TaskQueue[]>
  workers: Async<Worker[]>
  activities: Async<ActivityInfo[]>
  cluster: ClusterStatus | null
  health: string | null
  reload: () => void
}

function useNsData(ns: string): NsData {
  const [workflows, setWorkflows] = useState<Async<WorkflowExecution[]>>({ phase: 'loading' })
  const [schedules, setSchedules] = useState<Async<Schedule[]>>({ phase: 'loading' })
  const [queues, setQueues] = useState<Async<TaskQueue[]>>({ phase: 'loading' })
  const [workers, setWorkers] = useState<Async<Worker[]>>({ phase: 'loading' })
  const [activities, setActivities] = useState<Async<ActivityInfo[]>>({ phase: 'loading' })
  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [health, setHealth] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!ns) return
    const one = <T,>(p: Promise<T>, set: (s: Async<T>) => void) => {
      set({ phase: 'loading' })
      p.then((data) => set({ phase: 'ready', data })).catch((e) => set({ phase: 'error', error: classifyBackend(e) }))
    }
    one(TasksApi.workflows(ns), setWorkflows)
    one(TasksApi.schedules(ns), setSchedules)
    one(TasksApi.taskQueues(ns), setQueues)
    one(TasksApi.workers(ns), setWorkers)
    one(TasksApi.activities(ns), setActivities)
    TasksApi.cluster().then(setCluster).catch(() => setCluster(null))
    TasksApi.health().then((h) => setHealth(h.status)).catch(() => setHealth(null))
  }, [ns])

  useEffect(() => reload(), [reload])
  return { workflows, schedules, queues, workers, activities, cluster, health, reload }
}

// ── right rail ──────────────────────────────────────────────────────────────

function RailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$1">
      <Text fontSize="$2" color="$color11">{label}</Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>{value}</Text>
    </XStack>
  )
}

function Rail({ data }: { data: NsData }) {
  const wf = data.workflows.phase === 'ready' ? data.workflows.data : []
  const queues = data.queues.phase === 'ready' ? data.queues.data : []
  const series = throughput(wf)
  const hasThroughput = series.some((p) => p.value > 0)
  const recent = [...wf]
    .filter((w) => w.startTime)
    .sort((a, b) => new Date(b.startTime as string).getTime() - new Date(a.startTime as string).getTime())
    .slice(0, 6)

  return (
    <YStack width={320} minW={280} gap="$3">
      <Panel title="Engine health" minW={280} grow={false}>
        <YStack>
          <RailRow label="Status" value={data.health ? (data.health === 'ok' ? 'Healthy' : data.health) : '—'} />
          <RailRow label="Node" value={data.cluster?.nodeId || '—'} />
          <RailRow label="Replicator" value={data.cluster?.replicator || '—'} />
          <RailRow label="Shards" value={typeof data.cluster?.openShards === 'number' && typeof data.cluster?.shardCount === 'number' ? `${data.cluster.openShards}/${data.cluster.shardCount}` : '—'} />
          <RailRow label="Accepted" value={data.cluster?.stats?.accepted ?? '—'} />
          <RailRow label="Timeouts" value={data.cluster?.stats?.timeouts ?? '—'} />
        </YStack>
        <Text fontSize="$1" color="$color10">Hanzo Tasks runs as a single-node engine — one node, not a multi-service cluster.</Text>
      </Panel>

      <Panel title="Workflow throughput" minW={280} grow={false}>
        {hasThroughput ? (
          <LineChart data={series} height={120} formatValue={(v) => `${v} started`} />
        ) : (
          <Text fontSize="$2" color="$color10">Per-hour workflow starts appear here once workflows run.</Text>
        )}
      </Panel>

      <Panel title="Task queue utilization" minW={280} grow={false}>
        {queues.length ? (
          <BarRows bars={queues.slice(0, 6).map((q) => ({ label: q.name, value: q.running ?? q.workflows ?? 0 }))} />
        ) : (
          <Text fontSize="$2" color="$color10">No active task queues.</Text>
        )}
      </Panel>

      <Panel title="Recent workflows" minW={280} grow={false}>
        {recent.length ? (
          <YStack gap="$1.5">
            {recent.map((w) => (
              <XStack key={`${w.execution?.workflowId}/${w.execution?.runId}`} justify="space-between" items="center" gap="$2">
                <Text fontSize="$2" color="$color12" flex={1} numberOfLines={1}>{w.execution?.workflowId}</Text>
                <StatusPill status={w.status} />
              </XStack>
            ))}
          </YStack>
        ) : (
          <Text fontSize="$2" color="$color10">No recent workflows.</Text>
        )}
      </Panel>
    </YStack>
  )
}

// ── module ──────────────────────────────────────────────────────────────────

export function TasksModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = productSubpageSlug('tasks', params.tab)

  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [ns, setNs] = useState('')
  const [nsState, setNsState] = useState<BackendState | null>(null)
  const [selected, setSelected] = useState<{ wid: string; runId?: string } | null>(null)

  useEffect(() => {
    TasksApi.namespaces()
      .then((rows) => {
        setNamespaces(rows)
        const names = rows.map(nsName).filter(Boolean)
        setNs((cur) => cur || (names.includes('default') ? 'default' : names[0] ?? 'default'))
        setNsState(null)
      })
      .catch((e) => {
        // Even if the namespace list is gated/unreachable, default to 'default' so
        // the per-namespace reads render their own honest states.
        setNs((cur) => cur || 'default')
        setNsState(classifyBackend(e))
      })
  }, [])

  const active = ns || 'default'
  const data = useNsData(active)

  const wf = data.workflows.phase === 'ready' ? data.workflows.data : []
  const activities = data.activities.phase === 'ready' ? data.activities.data : []
  const stats = useMemo(() => {
    const by: Record<Bucket, number> = { running: 0, completed: 0, failed: 0, suspended: 0, other: 0 }
    let durSum = 0
    let durN = 0
    for (const w of wf) {
      const { bucket } = statusOf(w.status)
      by[bucket] += 1
      if (w.startTime && w.closeTime) {
        const d = new Date(w.closeTime).getTime() - new Date(w.startTime).getTime()
        if (d >= 0) { durSum += d; durN += 1 }
      }
    }
    const avg = durN ? `${Math.round(durSum / durN / 1000)}s` : '—'
    return { by, avg }
  }, [wf])

  const nsOptions = useMemo(() => namespaces.map(nsName).filter(Boolean), [namespaces])
  const ready = data.workflows.phase === 'ready'

  const go = (id: string) => router.push(`/tasks${id ? `/${id}` : ''}`)

  const workflowColumns: Column<WorkflowExecution>[] = [
    {
      key: 'wid',
      header: 'Workflow ID',
      render: (w) => (
        <YStack cursor="pointer" onPress={() => setSelected({ wid: w.execution.workflowId, runId: w.execution.runId })}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{w.execution?.workflowId}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{w.execution?.runId}</Text>
        </YStack>
      ),
    },
    { key: 'type', header: 'Type', width: 170, render: (w) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{w.type?.name || '—'}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (w) => <StatusPill status={w.status} /> },
    { key: 'started', header: 'Started', width: 180, render: (w) => <Text fontSize="$3" color="$color11">{fmt(w.startTime)}</Text> },
    { key: 'duration', header: 'Duration', width: 100, render: (w) => <Text fontSize="$3" color="$color11">{duration(w.startTime, w.closeTime)}</Text> },
    { key: 'queue', header: 'Task queue', width: 150, render: (w) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{w.taskQueue || '—'}</Text> },
    {
      key: 'actions',
      header: '',
      width: 90,
      render: (w) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => setSelected({ wid: w.execution.workflowId, runId: w.execution.runId })}>Open</Button>
        </XStack>
      ),
    },
  ]

  const scheduleColumns: Column<Schedule>[] = [
    { key: 'id', header: 'Schedule', render: (s) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{s.scheduleId}</Text> },
    { key: 'wf', header: 'Workflow', width: 200, render: (s) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{s.action?.workflowType?.name || '—'}</Text> },
    { key: 'state', header: 'State', width: 100, render: (s) => <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color4" color="$color12">{s.state?.paused ? 'Paused' : 'Active'}</Text> },
    { key: 'next', header: 'Next run', width: 180, render: (s) => <Text fontSize="$3" color="$color11">{fmt(s.info?.nextActionTime)}</Text> },
    { key: 'runs', header: 'Runs', width: 70, render: (s) => <Text fontSize="$3" color="$color11">{s.info?.actionCount ?? 0}</Text> },
  ]

  const queueColumns: Column<TaskQueue>[] = [
    { key: 'name', header: 'Task queue', render: (q) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{q.name}</Text> },
    { key: 'workflows', header: 'Workflows', width: 110, render: (q) => <Text fontSize="$3" color="$color11">{q.workflows ?? '—'}</Text> },
    { key: 'running', header: 'Running', width: 100, render: (q) => <Text fontSize="$3" color="$color11">{q.running ?? '—'}</Text> },
    { key: 'pollers', header: 'Pollers', width: 90, render: (q) => <Text fontSize="$3" color="$color11">{q.pollers ?? '—'}</Text> },
    { key: 'latest', header: 'Latest start', width: 180, render: (q) => <Text fontSize="$3" color="$color11">{fmt(q.latestStart)}</Text> },
  ]

  const workerColumns: Column<Worker>[] = [
    { key: 'id', header: 'Identity', render: (w) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{w.identity || '—'}</Text> },
    { key: 'queue', header: 'Task queue', width: 170, render: (w) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{w.taskQueue || '—'}</Text> },
    { key: 'wfp', header: 'WF pollers', width: 100, render: (w) => <Text fontSize="$3" color="$color11">{w.workflowPollers ?? '—'}</Text> },
    { key: 'acp', header: 'Act pollers', width: 100, render: (w) => <Text fontSize="$3" color="$color11">{w.activityPollers ?? '—'}</Text> },
    { key: 'last', header: 'Last seen', width: 180, render: (w) => <Text fontSize="$3" color="$color11">{fmt(w.lastAccessTime)}</Text> },
  ]

  const activityColumns: Column<ActivityInfo>[] = [
    { key: 'id', header: 'Activity', render: (a) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{a.activityId || '—'}</Text> },
    { key: 'type', header: 'Type', width: 170, render: (a) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{typeof a.activityType === 'string' ? a.activityType : a.activityType?.name || '—'}</Text> },
    { key: 'wf', header: 'Workflow', width: 170, render: (a) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{a.workflowId || '—'}</Text> },
    { key: 'state', header: 'State', width: 110, render: (a) => <Text fontSize="$3" color="$color11">{a.state || a.status || '—'}</Text> },
    { key: 'attempt', header: 'Attempt', width: 80, render: (a) => <Text fontSize="$3" color="$color11">{a.attempt ?? '—'}</Text> },
  ]

  const tabBody = (() => {
    if (tab === '') {
      if (data.workflows.phase === 'error') return <BackendStateCard state={data.workflows.error} onRetry={data.reload} hint="Workflows read from the tasks engine (/v1/tasks) with your session. Public TLS isn't live yet — the in-cluster engine is the real path." />
      return (
        <YStack gap="$3">
          <DataTable columns={workflowColumns} rows={wf} loading={data.workflows.phase === 'loading'} rowKey={(w) => `${w.execution?.workflowId}/${w.execution?.runId}`} empty="No workflows in this namespace yet." />
          {selected ? <WorkflowDetailPanel ns={active} wid={selected.wid} runId={selected.runId} onClose={() => setSelected(null)} /> : null}
        </YStack>
      )
    }
    if (tab === 'schedules') return data.schedules.phase === 'error' ? <BackendStateCard state={data.schedules.error} onRetry={data.reload} /> : <DataTable columns={scheduleColumns} rows={data.schedules.phase === 'ready' ? data.schedules.data : []} loading={data.schedules.phase === 'loading'} rowKey={(s) => s.scheduleId} empty="No schedules in this namespace." />
    if (tab === 'queues') return data.queues.phase === 'error' ? <BackendStateCard state={data.queues.error} onRetry={data.reload} /> : <DataTable columns={queueColumns} rows={data.queues.phase === 'ready' ? data.queues.data : []} loading={data.queues.phase === 'loading'} rowKey={(q) => q.name} empty="No task queues in this namespace." />
    if (tab === 'workers') return data.workers.phase === 'error' ? <BackendStateCard state={data.workers.error} onRetry={data.reload} hint="Workers appear once one heartbeats against a task queue." /> : <DataTable columns={workerColumns} rows={data.workers.phase === 'ready' ? data.workers.data : []} loading={data.workers.phase === 'loading'} rowKey={(w) => w.identity || Math.random().toString()} empty="No workers registered yet." />
    return data.activities.phase === 'error' ? <BackendStateCard state={data.activities.error} onRetry={data.reload} /> : <DataTable columns={activityColumns} rows={activities} loading={data.activities.phase === 'loading'} rowKey={(a) => a.activityId || Math.random().toString()} empty="No activities in this namespace." />
  })()

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Durable workflows, schedules, and queues — orchestrate, monitor, and debug."
        actions={<Button icon={<RefreshCw size={16} />} onPress={data.reload}>Refresh</Button>}
      />

      {nsState ? (
        <Text fontSize="$2" color="$color10">Namespace list unavailable ({nsState.message}) — showing “{active}”.</Text>
      ) : null}

      {/* Stat cards — REAL workflow counts; Activities/Avg from real data, honest "—" otherwise. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Activity size={15} />} label="Running" value={ready ? String(stats.by.running) : '—'} caption="in flight" />
        <MetricCard icon={<CheckCircle2 size={15} />} label="Completed" value={ready ? String(stats.by.completed) : '—'} caption="finished ok" />
        <MetricCard icon={<XCircle size={15} />} label="Failed" value={ready ? String(stats.by.failed) : '—'} caption="failed / timed out" />
        <MetricCard icon={<PauseCircle size={15} />} label="Suspended" value={ready ? String(stats.by.suspended) : '—'} caption="canceled / terminated" />
        <MetricCard icon={<Zap size={15} />} label="Activities" value={data.activities.phase === 'ready' ? String(activities.length) : '—'} caption="executions" />
        <MetricCard icon={<Timer size={15} />} label="Avg duration" value={ready ? stats.avg : '—'} caption="completed runs" />
      </XStack>

      <XStack gap="$3" items="center" flexWrap="wrap">
        <XStack width={240} items="center" gap="$2">
          <Text fontSize="$2" color="$color11">Namespace</Text>
          <YStack flex={1}><FieldSelect value={active} options={nsOptions.length ? nsOptions : [active]} onChange={setNs} /></YStack>
        </XStack>
        <SubNav id="tasks" />
      </XStack>

      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={1} minW={340} gap="$2">{tabBody}</YStack>
        <Rail data={data} />
      </XStack>
    </>
  )
}
