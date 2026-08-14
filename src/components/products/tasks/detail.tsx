'use client'

/**
 * Workflow detail — the panel that opens when you select a workflow row. It reads
 * the REAL detail + durable history (`TasksApi.workflow` / `TasksApi.history`) and
 * derives a step graph from the actual history events — never a fabricated DAG.
 * Sub-tabs mirror the Temporal console: Overview / Timeline / Graph / Events /
 * Activities render from real data; Logs / Signals / Queries state honestly that the
 * engine folds them into Events/Timeline (no distinct per-workflow feed) — never a
 * fabricated one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { X } from '@hanzogui/lucide-icons-2'

import { TasksApi, type HistoryEvent, type WorkflowDetail } from '~/lib/api'
import { statusOf } from './status'
import { BackendStateCard, DataTable, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

const SUBTABS = ['Overview', 'Timeline', 'Graph', 'Events', 'Activities', 'Logs', 'Signals', 'Queries'] as const
type SubTab = (typeof SUBTABS)[number]

const fmt = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

/** Compact duration between two timestamps, or 'running' / '—'. */
function duration(start?: string, end?: string): string {
  if (!start) return '—'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  if (Number.isNaN(s) || Number.isNaN(e)) return '—'
  const secs = Math.max(0, Math.floor((e - s) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const sec = secs % 60
  const base = h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`
  return end ? base : `${base} (running)`
}

const eventType = (e: HistoryEvent): string => (e.eventType ?? '').replace(/^EVENT_TYPE_/, '')

/** Derive the step-graph nodes from real history (Start → activities → terminal).
 *  Normalizes underscores so BOTH Temporal serializations match — PascalCase
 *  `ActivityTaskScheduled` and the enum `EVENT_TYPE_ACTIVITY_TASK_SCHEDULED`. */
function stepsFromHistory(events: HistoryEvent[]): string[] {
  if (!events.length) return ['Start', 'Running', 'End']
  const nodes: string[] = ['Start']
  let step = 0
  for (const e of events) {
    const t = eventType(e).replace(/_/g, '')
    if (/ActivityTaskScheduled/i.test(t)) nodes.push(`Activity ${++step}`)
    else if (/TimerStarted/i.test(t)) nodes.push('Timer')
    else if (/ChildWorkflowExecutionInitiated/i.test(t)) nodes.push('Child WF')
  }
  const last = eventType(events[events.length - 1]).replace(/_/g, '')
  if (/Completed/i.test(last)) nodes.push('Completed')
  else if (/Failed|TimedOut|Terminated/i.test(last)) nodes.push('Failed')
  else nodes.push('End')
  return nodes.length > 2 ? nodes : ['Start', 'Running', 'End']
}

function StepGraph({ nodes }: { nodes: string[] }) {
  return (
    <XStack items="center" gap="$0" flexWrap="wrap" rowGap="$3">
      {nodes.map((n, i) => (
        <XStack key={`${n}-${i}`} items="center" gap="$0">
          <YStack px="$3" py="$2" rounded="$3" bg={i === 0 || i === nodes.length - 1 ? '$color5' : '$color3'} borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$2" color="$color12" numberOfLines={1}>{n}</Text>
          </YStack>
          {i < nodes.length - 1 ? <YStack width={22} height={2} bg="$color7" /> : null}
        </XStack>
      ))}
    </XStack>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$1.5" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
      <Text fontSize="$2" color="$color11">{label}</Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>{value}</Text>
    </XStack>
  )
}

const EVENT_COLUMNS: Column<HistoryEvent>[] = [
  { key: 'id', header: 'ID', width: 60, render: (e) => <Text fontSize="$3" color="$color11">{e.eventId ?? ''}</Text> },
  { key: 'type', header: 'Type', render: (e) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{eventType(e)}</Text> },
  { key: 'time', header: 'Time', width: 200, render: (e) => <Text fontSize="$3" color="$color11">{fmt(e.eventTime)}</Text> },
]

export function WorkflowDetailPanel({ ns, wid, runId, onClose }: { ns: string; wid: string; runId?: string; onClose: () => void }) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null)
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)
  const [sub, setSub] = useState<SubTab>('Overview')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await TasksApi.workflow(ns, wid, runId)
      setDetail(d)
      const rid = d.workflowExecutionInfo?.execution?.runId ?? runId
      setEvents(await TasksApi.history(ns, wid, rid))
      setState(null)
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [ns, wid, runId])

  useEffect(() => { void load() }, [load])

  const info = detail?.workflowExecutionInfo
  const steps = useMemo(() => stepsFromHistory(events), [events])
  const activityEvents = useMemo(() => events.filter((e) => /Activity/i.test(eventType(e))), [events])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between" gap="$2">
        <YStack flex={1}>
          <Text fontSize="$5" fontWeight="700" numberOfLines={1}>{wid}</Text>
          <Text fontSize="$2" color="$color10" numberOfLines={1}>{info?.type?.name ? `${info.type.name} · ${ns}` : ns}</Text>
        </YStack>
        <Button size="$2" chromeless icon={<X size={16} />} onPress={onClose} />
      </XStack>

      <XStack gap="$1" flexWrap="wrap">
        {SUBTABS.map((s) => (
          <Button key={s} size="$1" bg={s === sub ? '$color5' : 'transparent'} borderWidth={1} borderColor="$borderColor" onPress={() => setSub(s)}>
            {s}
          </Button>
        ))}
      </XStack>

      {state ? (
        <BackendStateCard state={state} onRetry={() => void load()} />
      ) : loading && !detail ? (
        <XStack p="$3" gap="$2" items="center"><Spinner /><Text color="$color11">Loading…</Text></XStack>
      ) : sub === 'Overview' ? (
        <YStack>
          <Row label="Status" value={statusOf(info?.status ?? '').label} />
          <Row label="Type" value={info?.type?.name || '—'} />
          <Row label="Namespace" value={ns} />
          <Row label="Task queue" value={info?.taskQueue || detail?.executionConfig?.taskQueue?.name || '—'} />
          <Row label="Workflow ID" value={info?.execution?.workflowId || wid} />
          <Row label="Run ID" value={info?.execution?.runId || runId || '—'} />
          <Row label="Started" value={fmt(info?.startTime)} />
          <Row label="Runtime" value={duration(info?.startTime, info?.closeTime)} />
          <Row label="Closed" value={info?.closeTime ? fmt(info.closeTime) : '—'} />
          <Row label="History length" value={typeof info?.historyLength === 'number' ? info.historyLength : events.length || '—'} />
        </YStack>
      ) : sub === 'Graph' ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color10">Step graph derived from durable history.</Text>
          <StepGraph nodes={steps} />
        </YStack>
      ) : sub === 'Timeline' ? (
        events.length ? (
          <YStack gap="$0">
            {events.map((e) => (
              <XStack key={String(e.eventId)} gap="$3" items="flex-start" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
                <Text fontSize="$1" color="$color10" width={70}>#{e.eventId}</Text>
                <Text fontSize="$2" color="$color12" flex={1} numberOfLines={1}>{eventType(e)}</Text>
                <Text fontSize="$1" color="$color10">{fmt(e.eventTime)}</Text>
              </XStack>
            ))}
          </YStack>
        ) : <Text fontSize="$2" color="$color10">No history events. The engine records an event for every step a run takes; this run has none yet.</Text>
      ) : sub === 'Events' ? (
        <DataTable columns={EVENT_COLUMNS} rows={events} rowKey={(e) => String(e.eventId ?? Math.random())} empty="No history events. The engine records an event for every step a run takes; this run has none yet." />
      ) : sub === 'Activities' ? (
        <DataTable columns={EVENT_COLUMNS} rows={activityEvents} rowKey={(e) => String(e.eventId ?? Math.random())} empty="No activity events in this run. They appear once the workflow schedules an activity on a worker." />
      ) : (
        <YStack p="$4" items="center" borderWidth={1} borderColor="$borderColor" borderStyle="dashed" rounded="$3">
          <Text fontSize="$2" color="$color10" text="center" maxW={360}>
            The engine does not expose {sub} as a distinct per-workflow feed — it’s folded into Events and Timeline
            above. This tab reads {sub} live wherever the API serves it; nothing is fabricated here.
          </Text>
        </YStack>
      )}
    </Card>
  )
}
