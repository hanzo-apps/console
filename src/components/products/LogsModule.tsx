'use client'

/**
 * Logs — the org's real activity, in two honest tabs.
 *
 * REQUEST LOGS (default): the commerce usage ledger (`GET /v1/billing/usage` via the
 * per-tenant `/billing` proxy) — every billed API/model call is one row (time ·
 * endpoint · status · summary), rendered via the shared `logsFromRecords` and
 * filterable by endpoint and level.
 *
 * APPLICATION LOGS: full-text application/platform logs from the o11y log store
 * (ClickHouse via SigNoz). There is no clean logs-list route, so the real read is a
 * composite `POST /v1/o11y/v4/query_range` builder query — `ApmApi.logs` builds that
 * payload (data source `logs`, newest-first, optional body-contains filter) and
 * returns parsed rows (time · service · severity · message). Honest states throughout:
 * loading, an `ErrorState`/`RuntimeNotice`, and honest empties — never fabricated
 * lines. When the o11y runtime isn't initialized the query 503s and the tab shows the
 * honest RuntimeNotice.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, ScrollText } from '@hanzogui/lucide-icons-2'

import { asApiError, ErrorState } from '~/components/ui/States'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { SelectMenu, type SelectOption } from '~/components/ui/SelectMenu'
import { StatusTag } from '~/components/ui/StatusTag'
import { fetchUsageRecords, type UsageRecord } from '~/lib/api/aimetrics'
import { ApmApi, apmWindow, type LogRow } from '~/lib/api'
import { logsFromRecords, type LogLine } from '~/components/products/inference/logic'
import { Segmented, SearchInput } from '~/components/products/inference/parts'
import { RuntimeNotice } from '~/components/products/observability/RuntimeNotice'
import type { ApiError } from '~/lib/api'

const LOG_LIMIT = 250
const APP_LOG_LIMIT = 250

/** Honest local time label; em-dash when the row carries no parseable time. */
function fmtTime(at: number | null): string {
  if (at === null || at === 0) return '—'
  const d = new Date(at)
  return Number.isNaN(d.getTime())
    ? '—'
    : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}

type Tab = 'request' | 'application'

export function LogsModule(_props: { params: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>('request')
  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Your organization's recent request activity and application logs."
      />
      <XStack pb="$2">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { label: 'Request logs', value: 'request' },
            { label: 'Application logs', value: 'application' },
          ]}
        />
      </XStack>
      {tab === 'request' ? <RequestLogs /> : <ApplicationLogs />}
    </>
  )
}

// ── Request logs — the per-org billing/usage ledger ─────────────────────────────

type RequestState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; records: UsageRecord[] }

/** Distinct, sorted values for a filter dropdown (blank values dropped). */
function distinct(records: UsageRecord[], pick: (r: UsageRecord) => string): SelectOption<string>[] {
  const seen = new Set<string>()
  for (const r of records) {
    const v = pick(r)
    if (v) seen.add(v)
  }
  return [...seen].sort().map((v) => ({ key: v, label: v }))
}

function RequestLogs() {
  const [state, setState] = useState<RequestState>({ phase: 'loading' })
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [level, setLevel] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const records = await fetchUsageRecords()
      setState({ phase: 'ready', records })
    } catch (e) {
      setState({ phase: 'error', err: asApiError(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const records = state.phase === 'ready' ? state.records : []
  const endpointOptions = useMemo(() => distinct(records, (r) => r.model), [records])
  const levelOptions = useMemo(() => distinct(records, (r) => r.status), [records])
  const lines = useMemo(
    () => logsFromRecords(records, { endpoint: endpoint ?? 'all', level: level ?? 'all' }, LOG_LIMIT),
    [records, endpoint, level],
  )

  const columns: Column<LogLine>[] = [
    { key: 'at', header: 'Time', width: 190, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtTime(r.at)}</Text> },
    { key: 'endpoint', header: 'Endpoint', width: 200, render: (r) => <Text fontSize="$2" fontWeight="600" numberOfLines={1}>{r.endpoint}</Text> },
    { key: 'level', header: 'Level', width: 110, render: (r) => (r.level ? <StatusTag status={r.level} /> : <Text fontSize="$2" color="$color10">—</Text>) },
    { key: 'message', header: 'Message', render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.message}</Text> },
  ]

  if (state.phase === 'error') return <ErrorState err={state.err} onRetry={() => void load()} />

  return (
    <YStack gap="$3">
      <XStack gap="$2" items="center" flexWrap="wrap">
        <ScrollText size={16} />
        <Text fontSize="$2" color="$color10">Filter</Text>
        <SelectMenu options={endpointOptions} value={endpoint} onChange={setEndpoint} allLabel="All endpoints" />
        <SelectMenu options={levelOptions} value={level} onChange={setLevel} allLabel="All levels" />
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => void load()}>Refresh</Button>
      </XStack>

      <DataTable
        columns={columns}
        rows={lines}
        loading={state.phase === 'loading'}
        rowKey={(r) => r.id}
        empty="No request activity yet. Requests appear here as your org calls the API."
      />

      <Text fontSize="$1" color="$color10">
        Per-org request log from your usage ledger. Application/platform logs (o11y) are the
        other tab.
      </Text>
    </YStack>
  )
}

// ── Application logs — the o11y log store via SigNoz v4 query_range ─────────────

type AppState =
  | { phase: 'loading' }
  | { phase: 'error'; err: unknown }
  | { phase: 'ready'; rows: LogRow[] }

type RangeKey = '15m' | '1h' | '24h'
const RANGE_SECONDS: Record<RangeKey, number> = { '15m': 900, '1h': 3600, '24h': 86400 }

function ApplicationLogs() {
  const [state, setState] = useState<AppState>({ phase: 'loading' })
  const [range, setRange] = useState<RangeKey>('1h')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    const w = apmWindow(RANGE_SECONDS[range])
    try {
      const rows = await ApmApi.logs({ start: w.startMs, end: w.endMs, limit: APP_LOG_LIMIT, query: query.trim() || undefined })
      setState({ phase: 'ready', rows })
    } catch (e) {
      setState({ phase: 'error', err: e })
    }
  }, [range, query])

  // Debounced so typing in the search box (which re-queries server-side) doesn't
  // fire one query_range per keystroke — only the last change after a short idle.
  useEffect(() => {
    const t = setTimeout(() => void load(), 300)
    return () => clearTimeout(t)
  }, [load])

  const columns: Column<LogRow>[] = [
    { key: 'time', header: 'Time', width: 190, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtTime(r.timestampMs)}</Text> },
    { key: 'service', header: 'Service', width: 200, render: (r) => <Text fontSize="$2" fontWeight="600" numberOfLines={1}>{r.service || '—'}</Text> },
    { key: 'severity', header: 'Severity', width: 110, render: (r) => (r.severity ? <StatusTag status={r.severity} /> : <Text fontSize="$2" color="$color10">—</Text>) },
    { key: 'body', header: 'Message', render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.body}</Text> },
  ]

  return (
    <YStack gap="$3">
      <XStack gap="$2" items="center" flexWrap="wrap">
        <ScrollText size={16} />
        <Segmented<RangeKey>
          value={range}
          onChange={setRange}
          options={[
            { label: 'Last 15m', value: '15m' },
            { label: 'Last 1h', value: '1h' },
            { label: 'Last 24h', value: '24h' },
          ]}
        />
        <SearchInput value={query} onChange={setQuery} placeholder="Search log messages…" />
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => void load()}>Refresh</Button>
      </XStack>

      {state.phase === 'error' ? (
        <RuntimeNotice surface="logs" error={state.err} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={state.phase === 'ready' ? state.rows : []}
            loading={state.phase === 'loading'}
            rowKey={(r) => r.id}
            empty="No application logs in this window. Pod and container logs appear here once your services emit them."
          />
          <Text fontSize="$1" color="$color10">
            Application/platform logs from the o11y store · POST /v1/o11y/v4/query_range.
          </Text>
        </>
      )}
    </YStack>
  )
}
