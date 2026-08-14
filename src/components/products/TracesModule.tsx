'use client'

/**
 * Traces — list + detail for LLM/agent traces (HIP-0106), native on @hanzo/gui.
 *
 * List at `/o11y`, one trace at `/o11y/<id>` (selected by the `id` route param,
 * mirroring ProvidersModule/ResourceModule). Reads the REAL `/v1/o11y/traces`
 * surface; when the runtime is not initialized (503) or unrouted (404) it shows
 * an honest RuntimeNotice — never fabricated spans, costs, or charts.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ChevronRight, RefreshCw } from '@hanzogui/lucide-icons-2'

import {
  ApiError,
  O11yApi,
  type Observation,
  type O11yPageMeta,
  type Score,
  type Trace,
  type TraceDetail,
} from '~/lib/api'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { Badge, DetailRow, JsonCard, Tags } from './observability/parts'
import { SpanTree } from './observability/SpanTree'
import { elapsed, fmtCost, fmtDate, fmtLatency, fmtTokens, scoreValue } from './observability/format'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

const PAGE_LIMIT = 50

const traceLabel = (t: Pick<Trace, 'id' | 'name'>): string => t.name || t.id

/** List + pager surface — the index view. */
function TraceListView({ onOpen }: { onOpen: (t: Trace) => void }) {
  const [rows, setRows] = useState<Trace[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await O11yApi.traces({ page: p, limit: PAGE_LIMIT })
      setRows(res.data ?? [])
      setMeta(res.meta ?? null)
      setError(null)
    } catch (e) {
      setError(e)
      setRows([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(page)
  }, [load, page])

  const columns: Column<Trace>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (t) => (
        <Button chromeless px="$0" onPress={() => onOpen(t)}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {traceLabel(t)}
          </Text>
        </Button>
      ),
    },
    { key: 'timestamp', header: 'Timestamp', width: 190, render: (t) => <Text fontSize="$3" color="$color11">{fmtDate(t.timestamp)}</Text> },
    { key: 'userId', header: 'User', width: 140, render: (t) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{t.userId || '—'}</Text> },
    { key: 'latency', header: 'Latency', width: 100, render: (t) => <Text fontSize="$3" color="$color11">{fmtLatency(t.latency)}</Text> },
    { key: 'totalCost', header: 'Cost', width: 100, render: (t) => <Text fontSize="$3" color="$color11">{fmtCost(t.totalCost)}</Text> },
    { key: 'totalTokens', header: 'Tokens', width: 100, render: (t) => <Text fontSize="$3" color="$color11">{fmtTokens(t.totalTokens)}</Text> },
    {
      key: 'action',
      header: '',
      width: 120,
      render: (t) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => onOpen(t)}>
            Open
          </Button>
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Traces"
        subtitle="End-to-end LLM and agent traces."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <RuntimeNotice surface="traces" error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(t) => t.id}
            empty="No traces yet. Traces appear here once your workloads send them to the observability runtime."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}

/** Detail surface — overview, input/output, observations, and scores. */
function TraceDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [trace, setTrace] = useState<TraceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [obsView, setObsView] = useState<'tree' | 'table'>('tree')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await O11yApi.trace(id)
      setTrace(data)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const obsColumns: Column<Observation>[] = [
    { key: 'name', header: 'Name', render: (o) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{o.name || o.id}</Text> },
    { key: 'type', header: 'Type', width: 130, render: (o) => <Badge label={o.type} /> },
    { key: 'model', header: 'Model', width: 180, render: (o) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{o.model || '—'}</Text> },
    { key: 'latency', header: 'Latency', width: 100, render: (o) => <Text fontSize="$3" color="$color11">{fmtLatency(elapsed(o.startTime, o.endTime))}</Text> },
    { key: 'level', header: 'Level', width: 100, render: (o) => <Text fontSize="$3" color="$color11">{o.level}</Text> },
  ]

  const scoreColumns: Column<Score>[] = [
    { key: 'name', header: 'Name', render: (s) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{s.name}</Text> },
    { key: 'value', header: 'Value', width: 160, render: (s) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{scoreValue(s)}</Text> },
    { key: 'dataType', header: 'Type', width: 130, render: (s) => <Badge label={s.dataType} /> },
    { key: 'source', header: 'Source', width: 130, render: (s) => <Badge label={s.source} /> },
  ]

  return (
    <>
      <PageHeader
        title={trace ? traceLabel(trace) : id}
        subtitle="Trace detail"
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

      {error ? (
        <RuntimeNotice surface="traces" error={error} />
      ) : loading && !trace ? (
        <Text color="$color11">Loading…</Text>
      ) : trace ? (
        <>
          <Card p="$4" gap="$1" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700" mb="$2">
              Overview
            </Text>
            <DetailRow label="ID" value={trace.id} />
            <DetailRow label="Timestamp" value={fmtDate(trace.timestamp)} />
            <DetailRow label="User" value={trace.userId || '—'} />
            <DetailRow label="Session" value={trace.sessionId || '—'} />
            <DetailRow label="Environment" value={trace.environment || 'default'} />
            <DetailRow label="Latency" value={fmtLatency(trace.latency)} />
            <DetailRow label="Cost" value={fmtCost(trace.totalCost)} />
            {trace.release ? <DetailRow label="Release" value={trace.release} /> : null}
            {trace.version ? <DetailRow label="Version" value={trace.version} /> : null}
            <DetailRow label="Tags" value={<Tags tags={trace.tags} />} />
          </Card>

          <JsonCard title="Input" value={trace.input} />
          <JsonCard title="Output" value={trace.output} />
          <JsonCard title="Metadata" value={trace.metadata} />

          <YStack gap="$2">
            <XStack items="center" justify="space-between" gap="$3">
              <Text fontSize="$5" fontWeight="700">
                Observations
              </Text>
              <XStack gap="$1">
                {(['tree', 'table'] as const).map((v) => (
                  <Button
                    key={v}
                    size="$2"
                    bg={v === obsView ? '$color5' : 'transparent'}
                    borderWidth={1}
                    borderColor="$borderColor"
                    onPress={() => setObsView(v)}
                  >
                    {v === 'tree' ? 'Tree' : 'Table'}
                  </Button>
                ))}
              </XStack>
            </XStack>
            {obsView === 'tree' ? (
              <SpanTree observations={trace.observations ?? []} />
            ) : (
              <DataTable
                columns={obsColumns}
                rows={trace.observations ?? []}
                rowKey={(o) => o.id}
                empty="No observations on this trace. Observations are the spans inside a trace — model calls, tool calls, nested steps — sent by your app."
              />
            )}
          </YStack>

          <YStack gap="$2">
            <Text fontSize="$5" fontWeight="700">
              Scores
            </Text>
            <DataTable
              columns={scoreColumns}
              rows={trace.scores ?? []}
              rowKey={(s) => s.id}
              empty="No scores on this trace. Scores appear here once an evaluation or human feedback is recorded against it."
            />
          </YStack>
        </>
      ) : null}
    </>
  )
}

export function TracesModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const id = params.id
  if (id) {
    return <TraceDetailView id={decodeURIComponent(id)} onBack={() => router.push('/o11y')} />
  }
  return <TraceListView onOpen={(t) => router.push(`/o11y/${encodeURIComponent(t.id)}`)} />
}
