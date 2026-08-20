'use client'

/**
 * Logs — a searchable log stream over `/v1/sentinel/logs`. Query + period + level
 * filter + project scope; a row opens a detail rail with the full attributes and a
 * deep-link to the log's trace. Real lines only — an empty result is an honest
 * empty state, a failed load the shared `ErrorState`, never fabricated log lines.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Route } from '@hanzogui/lucide-icons-2'

import { SentryApi, type Period, type SentryLog, type SentryProject } from '~/lib/api/sentry'
import { SlideOver } from '~/components/ui/SlideOver'
import { ErrorState, asApiError } from '~/components/ui/States'
import { PeriodPicker, ProjectPicker, SearchInput, Pill, Fact } from './parts'
import { logLevelTone, fmtDateTime } from './logic'
import { toneVar } from '~/components/ui/tone'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

const LEVELS = ['', 'error', 'warning', 'info', 'debug'] as const

type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; logs: SentryLog[] }

export function LogsPanel({ projects }: { projects: SentryProject[] }) {
  const router = useRouter()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [project, setProject] = useState('')
  const [period, setPeriod] = useState<Period>('24h')
  const [level, setLevel] = useState<string>('')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<SentryLog | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const logs = await SentryApi.logs({ project, period, level, query })
      setState({ phase: 'ready', logs })
    } catch (e) {
      setState({ phase: 'error', error: e })
    }
  }, [project, period, level, query])

  useEffect(() => {
    void load()
  }, [load])

  const logs = state.phase === 'ready' ? state.logs : []

  const columns: Column<SentryLog>[] = [
    { key: 'timestamp', header: 'Time', width: 160, render: (l) => <Text fontSize="$2" color="$color11" className="hz-mono">{fmtDateTime(l.timestamp)}</Text> },
    { key: 'level', header: 'Level', width: 92, render: (l) => <Pill label={l.level} tone={logLevelTone(l.level)} /> },
    { key: 'message', header: 'Message', render: (l) => <Text fontSize="$2" color="$color12" numberOfLines={1} className="hz-mono">{l.message || '—'}</Text> },
    { key: 'logger', header: 'Logger', width: 150, render: (l) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{l.logger || '—'}</Text> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title="Logs"
        subtitle="Searchable application log stream across your projects."
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
        <SearchInput value={queryInput} onChange={setQueryInput} onSubmit={() => setQuery(queryInput.trim())} placeholder="Search logs…" />
        <XStack gap="$1" flexWrap="wrap">
          {LEVELS.map((lv) => (
            <Button
              key={lv || 'all'}
              size="$2"
              bg={lv === level ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => setLevel(lv)}
            >
              {lv || 'all'}
            </Button>
          ))}
        </XStack>
        <PeriodPicker value={period} onChange={setPeriod} />
      </XStack>

      {state.phase === 'error' ? (
        <ErrorState err={asApiError(state.error)} onRetry={() => void load()} />
      ) : (
        <DataTable<SentryLog>
          columns={columns}
          rows={logs}
          loading={state.phase === 'loading'}
          rowKey={(l) => l.id}
          onRowPress={setDetail}
          empty="No logs in this window. Logs appear here as your projects send them."
        />
      )}

      <SlideOver open={detail !== null} onClose={() => setDetail(null)} title="Log" size={460}>
        {detail ? (
          <YStack gap="$3">
            <XStack gap="$2" flexWrap="wrap">
              <Pill label={detail.level} tone={logLevelTone(detail.level)} />
              {detail.logger ? <Pill label={detail.logger} tone={toneVar('muted')} /> : null}
              {detail.project ? <Pill label={detail.project} tone={toneVar('neutral')} /> : null}
            </XStack>
            <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" p="$3" bg="$color1" style={{ overflowX: 'auto' }}>
              <Text fontSize="$2" color="$color12" className="hz-mono" style={{ whiteSpace: 'pre-wrap' }}>
                {detail.message || '—'}
              </Text>
            </YStack>
            <XStack gap="$4" flexWrap="wrap">
              <Fact label="Time" value={fmtDateTime(detail.timestamp)} />
              {detail.traceId ? <Fact label="Trace" value={detail.traceId} /> : null}
            </XStack>
            {detail.traceId ? (
              <Button size="$2.5" self="flex-start" icon={<Route size={15} />} onPress={() => router.push(`/sentry/traces/${encodeURIComponent(detail.traceId)}`)}>
                View trace
              </Button>
            ) : null}
            {Object.keys(detail.attributes).length > 0 ? (
              <YStack gap="$1.5">
                <Text fontSize="$2" fontWeight="600" color="$color11">
                  Attributes
                </Text>
                <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
                  {Object.entries(detail.attributes).map(([k, v], i) => (
                    <XStack key={k} gap="$2" px="$2.5" py="$1.5" borderTopWidth={i === 0 ? 0 : 1} borderColor="$borderColor">
                      <Text fontSize="$1" color="$color10" width={120} numberOfLines={1}>
                        {k}
                      </Text>
                      <Text fontSize="$1" color="$color12" className="hz-mono" flex={1} numberOfLines={1}>
                        {v}
                      </Text>
                    </XStack>
                  ))}
                </YStack>
              </YStack>
            ) : null}
          </YStack>
        ) : null}
      </SlideOver>
    </YStack>
  )
}
