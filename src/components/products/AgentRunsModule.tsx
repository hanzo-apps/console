'use client'

/**
 * Agent runs — the list + detail that connects a recorded run to the trace it
 * already produced.
 *
 * A run is written with a `traceId`, and `/o11y/<traceId>` already renders the full
 * span waterfall — but nothing listed runs AS runs, so a complete trace existed with
 * no way to reach it. This is that path: the org-wide feed at `/agents/runs`, one run
 * at `/agents/runs/<id>` (selected by the `id` route param, mirroring TracesModule),
 * and from both a jump into the existing waterfall.
 *
 * Honest by construction. `traceId` is `omitempty`: a run recorded before tracing
 * existed legitimately has none, which is NOT an error — `traceHref` returns null and
 * the surface says "no trace recorded" instead of rendering a link that 404s. A failed
 * read shows `BackendStateCard` (a 403 reads as "not enabled", never "no runs"), and
 * every absent field reads "—". Nothing here is fabricated.
 *
 * Style props are the @hanzo/gui v5 shorthand set (bg/p/px/py/gap/rounded/items/…).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, ArrowLeft, Bot, ChevronRight, RefreshCw, X } from '@hanzogui/lucide-icons-2'

import {
  AgentsApi,
  RUN_LIMIT_MAX,
  fmtDuration,
  fmtInt,
  fmtRelative,
  traceHref,
  type AgentRun,
  type AgentRunFilter,
} from '~/lib/api/agents'
import { PageHeader } from '~/components/ui/PageHeader'
import { SubNav } from '~/components/ui/SubNav'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusTag } from '~/components/ui/StatusTag'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { DetailRow, JsonCard } from './observability/parts'
import { fmtDate } from './observability/format'

/** First page size; "Show more" walks up to the largest page the feed serves. */
const PAGE_LIMIT = 50
const DASH = '—'
const ENDPOINT_HINT = 'endpoint · GET /v1/agents/runs'

/** The status filter, in display order. */
const FILTERS: { value: AgentRunFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ok', label: 'OK' },
  { value: 'error', label: 'Error' },
]

/** Absolute timestamp with a relative hint — a feed is read by "when", newest first. */
function When({ at }: { at: string }) {
  if (!at) return <Text fontSize="$3" color="$color12">{DASH}</Text>
  return (
    <YStack>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {fmtRelative(at)}
      </Text>
      <Text fontSize="$1" color="$color10" numberOfLines={1}>
        {fmtDate(at)}
      </Text>
    </YStack>
  )
}

/** "1,204 / 318" — prompt over completion; a side the run didn't record reads "—". */
const tokenPair = (r: AgentRun): string =>
  r.promptTokens === undefined && r.completionTokens === undefined
    ? DASH
    : `${fmtInt(r.promptTokens ?? null)} / ${fmtInt(r.completionTokens ?? null)}`

/** Open this run's existing span waterfall, or say honestly that it has none. */
function TraceLink({ run, size = '$2' }: { run: AgentRun; size?: '$2' | '$3' }) {
  const router = useRouter()
  const href = traceHref(run)
  if (!href) {
    return (
      <Text fontSize="$2" color="$color10">
        No trace
      </Text>
    )
  }
  return (
    <Button size={size} icon={<Activity size={14} />} onPress={() => router.push(href)}>
      Trace
    </Button>
  )
}

/** The feed — every agent's runs, newest first, with the served status filter. */
function RunListView({ onOpen }: { onOpen: (r: AgentRun) => void }) {
  const [rows, setRows] = useState<AgentRun[]>([])
  const [status, setStatus] = useState<AgentRunFilter>('all')
  // Scoping to one agent reads `GET /v1/agents/:ref/runs` — that route serves `limit`
  // only, so the status filter is applied to its rows here (same result, one control).
  const [agent, setAgent] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_LIMIT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(agent ? await AgentsApi.agentRuns(agent, { limit }) : await AgentsApi.runs({ limit, status }))
      setError(null)
    } catch (e) {
      setRows([])
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [agent, limit, status])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (status === 'all' ? rows : rows.filter((r) => r.status === status)),
    [rows, status],
  )
  const filtered = status !== 'all' || agent !== null
  // The feed serves one bounded page (no offset, no total), so "more" is knowable
  // only from a full page — never a fabricated page count.
  const maybeMore = rows.length >= limit && limit < RUN_LIMIT_MAX

  const columns: Column<AgentRun>[] = [
    {
      key: 'createdAt',
      header: 'Created',
      width: 150,
      render: (r) => (
        <Button chromeless px="$0" onPress={() => onOpen(r)} aria-label={`Open run ${r.id}`}>
          <XStack items="center" gap="$1.5">
            <When at={r.createdAt} />
            <ChevronRight size={14} color="$color10" />
          </XStack>
        </Button>
      ),
    },
    {
      key: 'agent',
      header: 'Agent',
      width: 130,
      render: (r) =>
        r.agent ? (
          <Button chromeless px="$0" onPress={() => setAgent(r.agent ?? null)} aria-label={`Only runs of ${r.agent}`}>
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
              {r.agent}
            </Text>
          </Button>
        ) : (
          <Text fontSize="$3" color="$color11">{DASH}</Text>
        ),
    },
    { key: 'status', header: 'Status', width: 80, render: (r) => <StatusTag status={r.status} /> },
    // The ONE flexing column, so the table fills the width without overflowing it.
    { key: 'model', header: 'Model', render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.model || DASH}</Text> },
    { key: 'durationMs', header: 'Duration', width: 90, align: 'right', mono: true, render: (r) => fmtDuration(r.durationMs) },
    { key: 'tokens', header: 'Tokens in / out', width: 120, align: 'right', mono: true, render: tokenPair },
    { key: 'toolCalls', header: 'Tools', width: 70, align: 'right', mono: true, render: (r) => fmtInt(r.toolCalls ?? null) },
    { key: 'actor', header: 'Actor', width: 110, render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.actor || DASH}</Text> },
    // Rendered straight into the cell (which right-aligns it): a `flex` wrapper
    // around a bare Text collapses its box to zero width inside a column cell.
    //
    // Last column, and the widths above are a BUDGET, not decoration: the table's
    // natural min-width is the sum of them, so a wider set pushed this — the whole
    // point of the surface — off the right edge behind a horizontal scroll at 1440px.
    { key: 'trace', header: 'Trace', width: 100, align: 'right', render: (r) => <TraceLink run={r} /> },
  ]

  const header = (
    <>
      <PageHeader
        title="Runs"
        subtitle="Every agent run, newest first — open one to read its input, output, and trace."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />
      <SubNav id="agents" />
    </>
  )

  if (error) {
    return (
      <>
        {header}
        <BackendStateCard state={error} onRetry={() => void load()} hint={ENDPOINT_HINT} />
      </>
    )
  }

  // A genuinely empty feed is an onboarding moment; an empty FILTER is not (the
  // table's own inline message says so without hiding the controls).
  if (!loading && rows.length === 0 && !filtered) {
    return (
      <>
        {header}
        <EmptyState
          icon={Bot}
          title="No runs yet"
          description="A run is recorded every time one of your agents executes. Runs appear here the moment an agent runs."
          bullets={[
            'Each run keeps its input, output, model, duration, and token usage.',
            'A run that produced a trace links straight to its span waterfall.',
          ]}
          primary={{ label: 'Go to Agents', onPress: () => window.location.assign('/agents') }}
        />
      </>
    )
  }

  return (
    <>
      {header}

      <XStack gap="$2" items="center" flexWrap="wrap" style={{ flexShrink: 1 }} minW={0}>
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="$2"
            bg={f.value === status ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => setStatus(f.value)}
            aria-current={f.value === status ? 'true' : undefined}
          >
            {f.label}
          </Button>
        ))}
        {agent ? (
          <Button size="$2" icon={<X size={14} />} borderWidth={1} borderColor="$borderColor" onPress={() => setAgent(null)}>
            {agent}
          </Button>
        ) : null}
      </XStack>

      <DataTable
        columns={columns}
        rows={visible}
        loading={loading}
        rowKey={(r) => r.id}
        empty={filtered ? 'No runs match this filter.' : 'No runs recorded yet.'}
      />

      <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
        <Text fontSize="$2" color="$color11">
          {loading ? 'Loading…' : `Showing the ${visible.length} most recent`}
        </Text>
        {maybeMore ? (
          <Button size="$2" onPress={() => setLimit((n) => Math.min(RUN_LIMIT_MAX, n * 2))}>
            Show more
          </Button>
        ) : null}
      </XStack>
    </>
  )
}

/**
 * One run — every recorded field, its input/output (or error), and the way into its
 * trace.
 *
 * The feed serves no per-run read, so the run is selected out of the largest page it
 * DOES serve. A run older than that window is said so plainly rather than shown as an
 * error or as an empty run.
 */
function RunDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const router = useRouter()
  const [run, setRun] = useState<AgentRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await AgentsApi.runs({ limit: RUN_LIMIT_MAX })
      setRun(rows.find((r) => r.id === id) ?? null)
      setError(null)
    } catch (e) {
      setRun(null)
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const href = run ? traceHref(run) : null

  const header = (
    <PageHeader
      title={run?.agent || id}
      subtitle="Run detail"
      actions={
        <XStack gap="$2" flexWrap="wrap">
          <Button icon={<ArrowLeft size={16} />} onPress={onBack}>
            Back
          </Button>
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
          {href ? (
            <Button theme="light" icon={<Activity size={16} />} onPress={() => router.push(href)}>
              View trace
            </Button>
          ) : null}
        </XStack>
      }
    />
  )

  if (error) {
    return (
      <>
        {header}
        <BackendStateCard state={error} onRetry={() => void load()} hint={ENDPOINT_HINT} />
      </>
    )
  }

  if (loading && !run) {
    return (
      <>
        {header}
        <Text color="$color11">Loading…</Text>
      </>
    )
  }

  if (!run) {
    return (
      <>
        {header}
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={640}>
          <Text fontSize="$4" fontWeight="700">
            Run not in the recent feed
          </Text>
          <Text fontSize="$3" color="$color11">
            Run {id} isn’t among the {RUN_LIMIT_MAX} most recent runs. The runs feed serves a bounded
            page and no per-run read, so an older run can’t be opened directly yet.
          </Text>
          <Button size="$2" self="flex-start" onPress={onBack}>
            Back to runs
          </Button>
        </Card>
      </>
    )
  }

  return (
    <>
      {header}

      <Card p="$4" gap="$1" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$5" fontWeight="700" mb="$2">
          Overview
        </Text>
        <DetailRow label="ID" value={run.id} />
        <DetailRow label="Status" value={<StatusTag status={run.status} />} />
        <DetailRow label="Agent" value={run.agent || DASH} />
        <DetailRow label="Actor" value={run.actor || DASH} />
        <DetailRow label="Model" value={run.model || DASH} />
        <DetailRow label="Created" value={run.createdAt ? fmtDate(run.createdAt) : DASH} />
        <DetailRow label="Duration" value={fmtDuration(run.durationMs)} />
        <DetailRow label="Prompt tokens" value={fmtInt(run.promptTokens ?? null)} />
        <DetailRow label="Completion tokens" value={fmtInt(run.completionTokens ?? null)} />
        <DetailRow label="Tool calls" value={fmtInt(run.toolCalls ?? null)} />
        <DetailRow
          label="Trace"
          value={
            href ? (
              <Button size="$2" icon={<Activity size={14} />} onPress={() => router.push(href)}>
                {run.traceId}
              </Button>
            ) : (
              'No trace recorded'
            )
          }
        />
      </Card>

      {href ? null : (
        <Text fontSize="$2" color="$color10">
          This run recorded no trace id, so there is no span waterfall to open. Runs from before
          tracing was enabled have none — that is not a failure.
        </Text>
      )}

      <JsonCard title="Input" value={run.input} />
      <JsonCard title={run.status === 'error' ? 'Output (partial)' : 'Output'} value={run.output} />
      <JsonCard title="Error" value={run.error} />
    </>
  )
}

export function AgentRunsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const id = params.id
  if (id) {
    return <RunDetailView id={decodeURIComponent(id)} onBack={() => router.push('/agents/runs')} />
  }
  return <RunListView onOpen={(r) => router.push(`/agents/runs/${encodeURIComponent(r.id)}`)} />
}
