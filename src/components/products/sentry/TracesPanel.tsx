'use client'

/**
 * Traces — list + detail over `/v1/sentry/traces`. The list is the root
 * transactions with roll-up duration/span/error counts; the detail is the span
 * WATERFALL for one trace (`/v1/sentry/traces/:id`). This is the APM-span domain
 * (duration/waterfall) — distinct from the console's LLM-trace module (cost/tokens/
 * scores over `/v1/o11y`), so it is its own surface in the same idiom (DataTable +
 * honest states), never fabricated spans.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, RefreshCw } from '@hanzogui/lucide-icons-2'

import { SentryApi, type Period, type SentrySpan, type SentryTrace, type SentryTraceDetail, type SentryProject } from '~/lib/api/sentry'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError } from '~/components/ui/States'
import { PeriodPicker, ProjectPicker, SearchInput, Fact } from './parts'
import { fmtDurationMs, fmtDateTime, fmtCount, logLevelTone } from './logic'
import { toneVar } from '~/components/ui/tone-var'

export function TracesPanel({ id, projects }: { id?: string; projects: SentryProject[] }) {
  const router = useRouter()
  if (id) return <TraceDetail id={decodeURIComponent(id)} onBack={() => router.push('/sentry/traces')} />
  return <TraceList projects={projects} onOpen={(t) => router.push(`/sentry/traces/${encodeURIComponent(t.traceId)}`)} />
}

function TraceList({ projects, onOpen }: { projects: SentryProject[]; onOpen: (t: SentryTrace) => void }) {
  const [rows, setRows] = useState<SentryTrace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [project, setProject] = useState('')
  const [period, setPeriod] = useState<Period>('24h')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await SentryApi.traces({ project, period, query }))
      setError(null)
    } catch (e) {
      setError(e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [project, period, query])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<SentryTrace>[] = [
    { key: 'transaction', header: 'Transaction', render: (t) => (
      <YStack minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{t.transaction || t.traceId}</Text>
        {t.op || t.service ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{[t.op, t.service].filter(Boolean).join(' · ')}</Text> : null}
      </YStack>
    ) },
    { key: 'durationMs', header: 'Duration', width: 100, align: 'right', mono: true, render: (t) => <Text className="hz-mono">{fmtDurationMs(t.durationMs)}</Text> },
    { key: 'spanCount', header: 'Spans', width: 76, align: 'right', mono: true, render: (t) => <Text className="hz-mono">{fmtCount(t.spanCount)}</Text> },
    { key: 'errorCount', header: 'Errors', width: 76, align: 'right', mono: true, render: (t) => <Text className="hz-mono" style={{ color: t.errorCount > 0 ? toneVar('critical') : undefined }}>{t.errorCount || 0}</Text> },
    { key: 'project', header: 'Project', width: 120, render: (t) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{t.project || '—'}</Text> },
    { key: 'timestamp', header: 'When', width: 150, render: (t) => <Text fontSize="$2" color="$color11">{fmtDateTime(t.timestamp)}</Text> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title="Traces"
        subtitle="Distributed traces across your services — latency, spans, and errors per transaction."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            <ProjectPicker projects={projects} value={project} onChange={setProject} />
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />
      <XStack gap="$2" items="center" flexWrap="wrap">
        <SearchInput value={queryInput} onChange={setQueryInput} onSubmit={() => setQuery(queryInput.trim())} placeholder="Search traces — transaction, op…" />
        <PeriodPicker value={period} onChange={setPeriod} />
      </XStack>
      {error ? (
        <ErrorState err={asApiError(error)} onRetry={() => void load()} />
      ) : (
        <DataTable<SentryTrace>
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(t) => t.traceId}
          onRowPress={onOpen}
          empty="No traces in this window. Traces appear here as your services send them."
        />
      )}
    </YStack>
  )
}

function TraceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [trace, setTrace] = useState<SentryTraceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTrace(await SentryApi.trace(id))
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

  return (
    <YStack gap="$4">
      <PageHeader
        title={trace?.transaction || 'Trace'}
        subtitle={id}
        actions={
          <XStack gap="$2">
            <Button icon={<ArrowLeft size={16} />} onPress={onBack}>
              Traces
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />
      {error ? (
        <ErrorState err={asApiError(error)} onRetry={() => void load()} />
      ) : loading && !trace ? (
        <YStack p="$6" items="center">
          <Spinner />
        </YStack>
      ) : trace ? (
        <>
          <Card p="$4" borderWidth={1} borderColor="$borderColor">
            <XStack gap="$4" flexWrap="wrap">
              <Fact label="Trace ID" value={trace.traceId} />
              <Fact label="Duration" value={fmtDurationMs(trace.durationMs)} />
              <Fact label="Spans" value={fmtCount(trace.spans.length)} />
              {trace.project ? <Fact label="Project" value={trace.project} /> : null}
              <Fact label="Started" value={fmtDateTime(trace.timestamp)} />
            </XStack>
          </Card>
          <Waterfall spans={trace.spans} traceDurationMs={trace.durationMs} />
        </>
      ) : null}
    </YStack>
  )
}

/** The span waterfall — each span as a bar positioned by its start + duration
 *  within the trace window, indented by its depth in the parent chain. */
function Waterfall({ spans, traceDurationMs }: { spans: SentrySpan[]; traceDurationMs: number }) {
  const { ordered, depthOf, total } = useMemo(() => {
    const byId = new Map(spans.map((s) => [s.spanId, s]))
    const depth = (s: SentrySpan): number => {
      let d = 0
      let cur: SentrySpan | undefined = s
      const seen = new Set<string>()
      while (cur && cur.parentSpanId && byId.has(cur.parentSpanId) && !seen.has(cur.spanId)) {
        seen.add(cur.spanId)
        cur = byId.get(cur.parentSpanId)
        d++
        if (d > 32) break // cycle guard
      }
      return d
    }
    const span = Math.max(traceDurationMs, ...spans.map((s) => s.startMs + s.durationMs), 1)
    const ordered = spans.slice().sort((a, b) => a.startMs - b.startMs)
    const depthOf = new Map(spans.map((s) => [s.spanId, depth(s)]))
    return { ordered, depthOf, total: span }
  }, [spans, traceDurationMs])

  if (spans.length === 0) {
    return (
      <Card p="$4" borderWidth={1} borderColor="$borderColor">
        <Text color="$color11">No spans recorded for this trace.</Text>
      </Card>
    )
  }

  return (
    <YStack gap="$1.5">
      <Text fontSize="$4" fontWeight="600" color="$color12">
        Spans
      </Text>
      <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
        {ordered.map((s, i) => {
          const left = Math.max(0, Math.min(100, (s.startMs / total) * 100))
          const width = Math.max(1.2, Math.min(100 - left, (s.durationMs / total) * 100))
          const err = /error|internal|fail|5\d\d/i.test(s.status)
          const depth = depthOf.get(s.spanId) ?? 0
          return (
            <XStack key={s.spanId || i} gap="$2" px="$2.5" py="$1.5" items="center" borderTopWidth={i === 0 ? 0 : 1} borderColor="$borderColor">
              <YStack width={220} minW={220} style={{ paddingLeft: depth * 12 }}>
                <Text fontSize="$2" color="$color12" numberOfLines={1} className="hz-mono">
                  {s.op || 'span'}
                </Text>
                {s.description ? (
                  <Text fontSize="$1" color="$color10" numberOfLines={1}>
                    {s.description}
                  </Text>
                ) : null}
              </YStack>
              <YStack flex={1} height={16} justify="center" style={{ position: 'relative' }}>
                <YStack
                  height={10}
                  rounded="$1"
                  style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, backgroundColor: err ? toneVar('critical') : logLevelTone('info') }}
                />
              </YStack>
              <Text width={72} text="right" fontSize="$1" color="$color11" className="hz-mono">
                {fmtDurationMs(s.durationMs)}
              </Text>
            </XStack>
          )
        })}
      </YStack>
    </YStack>
  )
}
