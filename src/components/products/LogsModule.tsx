'use client'

/**
 * Logs — the org's REAL recent request activity (per-org, per-request).
 *
 * Wired to the commerce usage ledger (`GET /v1/billing/usage` via the per-tenant
 * `/billing` proxy) — the ONE real per-request source the console has today: every
 * billed API/model call is one row (time · endpoint · status · summary). We render
 * those as log lines via the shared `logsFromRecords`, filterable by endpoint and
 * level. Honest states throughout: loading, error, and an honest empty ("no request
 * activity yet") — never a fabricated or permanently-empty grid.
 *
 * NOT wired (honest backend gap): full-text APPLICATION/platform log search over
 * o11y. The Hanzo o11y log store is deployed but exposes no clean logs-list read
 * route — `/v1/o11y/v1/logs` is a stub returning `{"results":[]}` and the only real
 * read is a composite `POST /v1/o11y/v4/query_range` builder query. When a simple
 * logs-list route (or a `/telemetry`-style read proxy fronting it) lands, this page
 * gains an application-log tab with no other change. Until then it shows the real
 * per-org REQUEST log above, which is genuinely useful and never fabricated.
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
import { logsFromRecords, type LogLine } from '~/components/products/inference/logic'
import type { ApiError } from '~/lib/api'

const LOG_LIMIT = 250

type State =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; records: UsageRecord[] }

/** Honest local time label; em-dash when the ledger row carries no parseable time. */
function fmtTime(at: number | null): string {
  if (at === null) return '—'
  const d = new Date(at)
  return Number.isNaN(d.getTime())
    ? '—'
    : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}

/** Distinct, sorted values for a filter dropdown (blank values dropped). */
function distinct(records: UsageRecord[], pick: (r: UsageRecord) => string): SelectOption<string>[] {
  const seen = new Set<string>()
  for (const r of records) {
    const v = pick(r)
    if (v) seen.add(v)
  }
  return [...seen].sort().map((v) => ({ key: v, label: v }))
}

export function LogsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
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

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Your organization's recent API and model requests."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'error' ? (
        <ErrorState err={state.err} onRetry={() => void load()} />
      ) : (
        <YStack gap="$3">
          <XStack gap="$2" items="center" flexWrap="wrap">
            <ScrollText size={16} />
            <Text fontSize="$2" color="$color10">Filter</Text>
            <SelectMenu
              options={endpointOptions}
              value={endpoint}
              onChange={setEndpoint}
              allLabel="All endpoints"
            />
            <SelectMenu options={levelOptions} value={level} onChange={setLevel} allLabel="All levels" />
          </XStack>

          <DataTable
            columns={columns}
            rows={lines}
            loading={state.phase === 'loading'}
            rowKey={(r) => r.id}
            empty="No request activity yet. Requests appear here as your org calls the API."
          />

          <Text fontSize="$1" color="$color10">
            Per-org request log from your usage ledger. Full-text application/platform log search
            (o11y) is a separate surface — it lands here as an application-log tab once the o11y
            logs-list read route is wired.
          </Text>
        </YStack>
      )}
    </>
  )
}
