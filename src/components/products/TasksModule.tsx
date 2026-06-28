'use client'

/**
 * Tasks — the user's durable workflows and schedules, unified into the console.
 *
 * Index (`/tasks`): pick a namespace, then browse its workflow executions (one
 * durable "task" each) or its schedules (recurring tasks), with a live cluster
 * strip. Detail (`/tasks/<ns>/<workflowId>`): one workflow's overview + durable
 * history. Reads the REAL `/v1/tasks` engine (hanzoai/tasks) through TasksApi;
 * every call is org-scoped server-side, so the browser sends cookie credentials
 * only. Honest states render when a route is gated/absent — never fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, RefreshCw, ChevronRight } from '@hanzogui/lucide-icons-2'

import {
  TasksApi,
  type ClusterStatus,
  type Namespace,
  type Schedule,
  type WorkflowExecution,
  type HistoryEvent,
  type WorkflowDetail,
} from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldSelect } from '~/components/ui/Field'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

const fmtDate = (v?: string): string => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

// ── workflow status → label + tone ─────────────────────────────────────────
type Tone = 'green' | 'yellow' | 'red' | 'neutral'
const TONE_BG = { green: '$color5', yellow: '$color4', red: '$color4', neutral: '$color3' } as const
const TONE_FG = { green: '$color12', yellow: '$color12', red: '$color12', neutral: '$color11' } as const

/** Map a `WORKFLOW_EXECUTION_STATUS_*` string to a readable label + tone. */
function wfStatus(raw: string): { label: string; tone: Tone } {
  const s = (raw || '').replace(/^WORKFLOW_EXECUTION_STATUS_/, '').toUpperCase()
  switch (s) {
    case 'RUNNING':
      return { label: 'Running', tone: 'green' }
    case 'COMPLETED':
      return { label: 'Completed', tone: 'green' }
    case 'FAILED':
      return { label: 'Failed', tone: 'red' }
    case 'TIMED_OUT':
      return { label: 'Timed out', tone: 'red' }
    case 'TERMINATED':
      return { label: 'Terminated', tone: 'red' }
    case 'CANCELED':
      return { label: 'Canceled', tone: 'neutral' }
    case 'CONTINUED_AS_NEW':
      return { label: 'Continued', tone: 'neutral' }
    default:
      return { label: s ? s.replace(/_/g, ' ').toLowerCase() : 'unknown', tone: 'neutral' }
  }
}

function StatusBadge({ status }: { status: string }) {
  const { label, tone } = wfStatus(status)
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg={TONE_BG[tone]} color={TONE_FG[tone]}>
      {label}
    </Text>
  )
}

function StateBadge({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <Text
      fontSize="$1"
      px="$2"
      py="$1"
      rounded="$2"
      bg={on ? '$color4' : '$color5'}
      color="$color12"
    >
      {on ? onLabel : offLabel}
    </Text>
  )
}

const nsName = (n: Namespace): string => n.namespaceInfo?.name ?? ''

/** The thin live cluster strip (best-effort; hidden when unavailable). */
function ClusterStrip({ cluster, health }: { cluster: ClusterStatus | null; health: string | null }) {
  if (!cluster && !health) return null
  const parts: string[] = []
  if (cluster?.replicator) parts.push(`engine ${cluster.replicator}`)
  if (typeof cluster?.openShards === 'number' && typeof cluster?.shardCount === 'number') {
    parts.push(`shards ${cluster.openShards}/${cluster.shardCount}`)
  }
  if (health) parts.push(health === 'ok' ? 'healthy' : health)
  if (parts.length === 0) return null
  return (
    <Text fontSize="$2" color="$color10">
      {parts.join(' · ')}
    </Text>
  )
}

// ── index: namespace + tabs ─────────────────────────────────────────────────

type Tab = 'workflows' | 'schedules'

function TasksIndex({ onOpen }: { onOpen: (ns: string, wf: WorkflowExecution) => void }) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [ns, setNs] = useState<string>('')
  const [tab, setTab] = useState<Tab>('workflows')

  const [workflows, setWorkflows] = useState<WorkflowExecution[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)

  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [health, setHealth] = useState<string | null>(null)

  // Namespaces first — the org tenant set. Default to "default", else the first.
  const loadNamespaces = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await TasksApi.namespaces()
      setNamespaces(rows)
      const names = rows.map(nsName).filter(Boolean)
      setNs((cur) => cur || (names.includes('default') ? 'default' : names[0] ?? ''))
      setState(null)
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNamespaces()
    // Cluster strip is best-effort; failures never block the page.
    TasksApi.cluster().then(setCluster).catch(() => setCluster(null))
    TasksApi.health()
      .then((h) => setHealth(h.status))
      .catch(() => setHealth(null))
  }, [loadNamespaces])

  const loadTab = useCallback(async () => {
    if (!ns) return
    setLoading(true)
    try {
      if (tab === 'workflows') setWorkflows(await TasksApi.workflows(ns))
      else setSchedules(await TasksApi.schedules(ns))
      setState(null)
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [ns, tab])

  useEffect(() => {
    void loadTab()
  }, [loadTab])

  const nsOptions = useMemo(() => namespaces.map(nsName).filter(Boolean), [namespaces])

  const workflowColumns: Column<WorkflowExecution>[] = [
    {
      key: 'workflowId',
      header: 'Workflow',
      render: (w) => (
        <Text fontSize="$3" color="$color12" numberOfLines={1} onPress={() => onOpen(ns, w)} cursor="pointer">
          {w.execution?.workflowId}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 200,
      render: (w) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {w.type?.name}
        </Text>
      ),
    },
    { key: 'status', header: 'Status', width: 130, render: (w) => <StatusBadge status={w.status} /> },
    {
      key: 'taskQueue',
      header: 'Task queue',
      width: 160,
      render: (w) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {w.taskQueue || '—'}
        </Text>
      ),
    },
    {
      key: 'startTime',
      header: 'Started',
      width: 190,
      render: (w) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(w.startTime)}
        </Text>
      ),
    },
    {
      key: 'action',
      header: '',
      width: 110,
      render: (w) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => onOpen(ns, w)}>
            Open
          </Button>
        </XStack>
      ),
    },
  ]

  const scheduleColumns: Column<Schedule>[] = [
    { key: 'scheduleId', header: 'Schedule', render: (s) => (
      <Text fontSize="$3" color="$color12" numberOfLines={1}>{s.scheduleId}</Text>
    ) },
    {
      key: 'workflowType',
      header: 'Workflow',
      width: 200,
      render: (s) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {s.action?.workflowType?.name || '—'}
        </Text>
      ),
    },
    {
      key: 'paused',
      header: 'State',
      width: 110,
      render: (s) => <StateBadge on={!!s.state?.paused} onLabel="Paused" offLabel="Active" />,
    },
    {
      key: 'next',
      header: 'Next run',
      width: 190,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(s.info?.nextActionTime) || '—'}
        </Text>
      ),
    },
    {
      key: 'count',
      header: 'Runs',
      width: 80,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {s.info?.actionCount ?? 0}
        </Text>
      ),
    },
  ]

  const TabButton = ({ id, label }: { id: Tab; label: string }) => (
    <Button size="$2" theme={tab === id ? 'light' : undefined} onPress={() => setTab(id)}>
      {label}
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Your durable workflows and schedules — every running and finished task, in one place."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void loadTab()}>
            Refresh
          </Button>
        }
      />

      <ClusterStrip cluster={cluster} health={health} />

      {state ? (
        <BackendStateCard
          state={state}
          onRetry={() => {
            void loadNamespaces()
            void loadTab()
          }}
          hint="The Tasks engine (/v1/tasks) is reached through the gateway with your session. Workflows and schedules appear here once the route is live for your org."
        />
      ) : nsOptions.length === 0 && !loading ? (
        <Card p="$4" borderWidth={1} borderColor="$borderColor">
          <Text color="$color11">
            No task namespaces yet for your organization. Workflows appear here once a worker registers
            one.
          </Text>
        </Card>
      ) : (
        <>
          <XStack gap="$3" items="center" flexWrap="wrap">
            <XStack width={260} items="center" gap="$2">
              <Text fontSize="$2" color="$color11">
                Namespace
              </Text>
              <YStack flex={1}>
                <FieldSelect value={ns} options={nsOptions} onChange={setNs} />
              </YStack>
            </XStack>
            <XStack gap="$2">
              <TabButton id="workflows" label="Workflows" />
              <TabButton id="schedules" label="Schedules" />
            </XStack>
          </XStack>

          {tab === 'workflows' ? (
            <DataTable
              columns={workflowColumns}
              rows={workflows}
              loading={loading}
              rowKey={(w) => `${w.execution?.workflowId}/${w.execution?.runId}`}
              empty="No workflows in this namespace yet."
            />
          ) : (
            <DataTable
              columns={scheduleColumns}
              rows={schedules}
              loading={loading}
              rowKey={(s) => s.scheduleId}
              empty="No schedules in this namespace yet."
            />
          )}
        </>
      )}
    </>
  )
}

// ── detail: one workflow ────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$2" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$3" color="$color11" fontWeight="600">
        {label}
      </Text>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

function WorkflowDetailView({ ns, wid, onBack }: { ns: string; wid: string; onBack: () => void }) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null)
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await TasksApi.workflow(ns, wid)
      setDetail(d)
      const runId = d.workflowExecutionInfo?.execution?.runId
      setEvents(await TasksApi.history(ns, wid, runId))
      setState(null)
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [ns, wid])

  useEffect(() => {
    void load()
  }, [load])

  const info = detail?.workflowExecutionInfo

  const eventColumns: Column<HistoryEvent>[] = [
    {
      key: 'eventId',
      header: 'ID',
      width: 70,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {e.eventId ?? ''}
        </Text>
      ),
    },
    {
      key: 'eventType',
      header: 'Type',
      render: (e) => (
        <Text fontSize="$3" color="$color12" numberOfLines={1}>
          {e.eventType ?? ''}
        </Text>
      ),
    },
    {
      key: 'eventTime',
      header: 'Time',
      width: 210,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(e.eventTime)}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={wid}
        subtitle={info?.type?.name ? `${info.type.name} · ${ns}` : ns}
        actions={
          <XStack gap="$2">
            <Button icon={<ArrowLeft size={16} />} onPress={onBack}>
              Back
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state ? (
        <BackendStateCard state={state} onRetry={() => void load()} />
      ) : loading && !detail ? (
        <Text color="$color11">Loading…</Text>
      ) : info ? (
        <>
          <Card p="$4" gap="$1" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700" mb="$2">
              Overview
            </Text>
            <DetailRow label="Status" value={<StatusBadge status={info.status} />} />
            <DetailRow label="Type" value={info.type?.name || '—'} />
            <DetailRow label="Task queue" value={info.taskQueue || detail?.executionConfig?.taskQueue?.name || '—'} />
            <DetailRow label="Run ID" value={info.execution?.runId || '—'} />
            {info.startTime ? <DetailRow label="Started" value={fmtDate(info.startTime)} /> : null}
            {info.closeTime ? <DetailRow label="Closed" value={fmtDate(info.closeTime)} /> : null}
            {typeof info.historyLength === 'number' ? (
              <DetailRow label="History length" value={info.historyLength} />
            ) : null}
          </Card>

          <YStack gap="$2">
            <Text fontSize="$5" fontWeight="700">
              History
            </Text>
            <DataTable
              columns={eventColumns}
              rows={events}
              loading={loading}
              rowKey={(e) => String(e.eventId ?? '')}
              empty="No history events."
            />
          </YStack>
        </>
      ) : null}
    </>
  )
}

export function TasksModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const { ns, wid } = params
  if (ns && wid) {
    return (
      <WorkflowDetailView
        ns={decodeURIComponent(ns)}
        wid={decodeURIComponent(wid)}
        onBack={() => router.push('/tasks')}
      />
    )
  }
  return (
    <TasksIndex
      onOpen={(namespace, wf) =>
        router.push(`/tasks/${encodeURIComponent(namespace)}/${encodeURIComponent(wf.execution.workflowId)}`)
      }
    />
  )
}
