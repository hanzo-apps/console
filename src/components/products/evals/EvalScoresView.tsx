'use client'

/**
 * Eval scores — the REAL score list from GET /v1/evals/scores (the cloud evals
 * facade proxies the console's public scores API verbatim). Numeric scores show
 * their value; categorical scores show their string value. Every state is honest:
 * loading, the backend-state card on failure, and a true empty state — no
 * fabricated scores.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { EvalsApi, type EvalScore } from '~/lib/api'
import { BackendStateCard, DataTable, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; rows: EvalScore[]; total: number }

const fmtTime = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

const scoreValue = (r: EvalScore): string => {
  if (typeof r.value === 'number') return r.value.toFixed(4).replace(/\.?0+$/, '')
  if (r.stringValue) return r.stringValue
  return '—'
}

const muted = (v?: string) => (
  <Text fontSize="$3" color={v ? '$color11' : '$color10'} numberOfLines={1}>
    {v || '—'}
  </Text>
)

const columns: Column<EvalScore>[] = [
  { key: 'name', header: 'Name', render: (r) => (
    <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{r.name || '—'}</Text>
  ) },
  { key: 'value', header: 'Value', width: 120, render: (r) => (
    <Text fontSize="$3" color="$color12">{scoreValue(r)}</Text>
  ) },
  { key: 'dataType', header: 'Type', width: 110, render: (r) => muted(r.dataType) },
  { key: 'source', header: 'Source', width: 110, render: (r) => muted(r.source) },
  { key: 'traceId', header: 'Trace', width: 150, render: (r) => muted(r.traceId) },
  { key: 'timestamp', header: 'Time', width: 190, render: (r) => muted(fmtTime(r.timestamp ?? r.createdAt)) },
]

export function EvalScoresView() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    EvalsApi.listScores({ limit: 50 })
      .then((page) =>
        setState({
          phase: 'ready',
          rows: page.data ?? [],
          total: page.meta?.totalItems ?? page.data?.length ?? 0,
        }),
      )
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (state.phase === 'error') {
    return (
      <BackendStateCard
        state={state.error}
        onRetry={load}
        hint="endpoint · GET /v1/evals/scores"
      />
    )
  }

  return (
    <>
      <XStack justify="space-between" items="center">
        <Text fontSize="$3" color="$color11">
          {state.phase === 'ready' ? `${state.total} score${state.total === 1 ? '' : 's'}` : 'Loading…'}
        </Text>
        <Button size="$2" icon={<RefreshCw size={14} />} onPress={load}>
          Refresh
        </Button>
      </XStack>
      <DataTable
        columns={columns}
        rows={state.phase === 'ready' ? state.rows : []}
        loading={state.phase === 'loading'}
        rowKey={(r) => r.id}
        empty="No scores yet. Run an eval to produce scores."
      />
    </>
  )
}
