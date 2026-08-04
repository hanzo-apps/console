'use client'

/**
 * Issues — the Sentry home: grouped-by-fingerprint issues over `/v1/sentry/issues`.
 * Search (query), status filter, sort, time period + project pickers, a per-issue
 * sparkline, KPI cards, and a by-level donut. Every KPI/slice/row is a fold over
 * what the backend returned — an empty result is an honest empty state, a failed
 * load is the shared honest `ErrorState` (503/404/403/401), never fabricated issues.
 * A row opens the issue detail (`/sentry/issues/:id`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, AlertTriangle, RefreshCw, TrendingUp, Users } from '@hanzogui/lucide-icons-2'

import { SentryApi, type IssueStatus, type Period, type SentryIssue, type SentryProject } from '~/lib/api/sentry'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { Sparkline, Donut } from '~/components/ui/Charts'
import { ErrorState, asApiError } from '~/components/ui/States'
import { FieldSelect } from '~/components/ui/Field'
import { PeriodPicker, ProjectPicker, SearchInput } from './parts'
import { summarizeIssues, levelSlices, fmtWhen, fmtCount, statusTone, ISSUE_SORTS } from './logic'
import { toneColor, toneVar } from '~/components/ui/tone'

const STATUS_TABS: { label: string; status: '' | IssueStatus }[] = [
  { label: 'Unresolved', status: 'unresolved' },
  { label: 'All', status: '' },
  { label: 'Resolved', status: 'resolved' },
  { label: 'Ignored', status: 'ignored' },
]

type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; issues: SentryIssue[] }

export function IssuesPanel({ projects }: { projects: SentryProject[] }) {
  const router = useRouter()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [tab, setTab] = useState(0)
  const [sort, setSort] = useState<'lastSeen' | 'firstSeen' | 'freq'>('lastSeen')
  const [period, setPeriod] = useState<Period>('24h')
  const [project, setProject] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const issues = await SentryApi.issues({ status: STATUS_TABS[tab].status, sort, period, project, query })
      setState({ phase: 'ready', issues })
    } catch (e) {
      setState({ phase: 'error', error: e })
    }
  }, [tab, sort, period, project, query])

  useEffect(() => {
    void load()
  }, [load])

  const open = (id: string) => router.push(`/sentry/issues/${encodeURIComponent(id)}`)

  const issues = state.phase === 'ready' ? state.issues : []
  const kpis = summarizeIssues(issues)
  const slices = levelSlices(issues)

  const columns: Column<SentryIssue>[] = useMemo(
    () => [
      {
        key: 'issue',
        header: 'Issue',
        render: (r) => (
          <YStack gap="$0.5" minW={0}>
            <XStack gap="$2" items="center">
              <YStack width={7} height={7} rounded="$10" style={{ backgroundColor: statusTone(r.status) }} />
              <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                {r.type || 'Error'}
              </Text>
              {r.regressed ? (
                <Text fontSize="$1" color={toneColor('warning')}>
                  regressed
                </Text>
              ) : null}
            </XStack>
            <Text fontSize="$2" color="$color11" numberOfLines={1}>
              {r.value || r.title || '—'}
            </Text>
            {r.culprit ? (
              <Text fontSize="$1" color="$color10" numberOfLines={1} className="mono">
                {r.culprit}
              </Text>
            ) : null}
          </YStack>
        ),
      },
      {
        key: 'trend',
        header: 'Trend',
        width: 130,
        render: (r) => (r.stats.length >= 2 ? <Sparkline values={r.stats} color={toneVar('critical')} /> : <Text color="$color10">—</Text>),
      },
      { key: 'count', header: 'Events', width: 84, align: 'right', mono: true, render: (r) => <Text className="mono">{fmtCount(r.count)}</Text> },
      { key: 'userCount', header: 'Users', width: 72, align: 'right', mono: true, render: (r) => <Text className="mono">{r.userCount ? fmtCount(r.userCount) : '—'}</Text> },
      { key: 'project', header: 'Project', width: 120, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.project || '—'}</Text> },
      { key: 'lastSeen', header: 'Last seen', width: 104, render: (r) => <Text fontSize="$2" color="$color11">{fmtWhen(r.lastSeen)}</Text> },
      {
        key: 'status',
        header: 'Status',
        width: 100,
        render: (r) => (
          <Text fontSize="$2" fontWeight="500" style={{ color: statusTone(r.status) }}>
            {r.status}
          </Text>
        ),
      },
    ],
    [],
  )

  return (
    <YStack gap="$4">
      <PageHeader
        title="Issues"
        subtitle="Grouped exceptions and crashes across your projects — one issue per fingerprint."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            <ProjectPicker projects={projects} value={project} onChange={setProject} />
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {/* Filter bar — status tabs, search, sort, period. */}
      <YStack gap="$2.5">
        <XStack gap="$2" flexWrap="wrap">
          {STATUS_TABS.map((t, i) => (
            <Button
              key={t.label}
              size="$2.5"
              bg={i === tab ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => setTab(i)}
            >
              {t.label}
            </Button>
          ))}
        </XStack>
        <XStack gap="$2" items="center" flexWrap="wrap">
          <SearchInput
            value={queryInput}
            onChange={setQueryInput}
            onSubmit={() => setQuery(queryInput.trim())}
            placeholder="Search issues — message, type, tag…"
          />
          <YStack width={150}>
            <FieldSelect value={sort} options={ISSUE_SORTS.map((s) => s.value)} onChange={(v) => setSort(v as typeof sort)} />
          </YStack>
          <PeriodPicker value={period} onChange={setPeriod} />
        </XStack>
      </YStack>

      {state.phase === 'error' ? (
        <ErrorState err={asApiError(state.error)} onRetry={() => void load()} />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <MetricCard icon={<AlertTriangle size={16} color={toneColor('critical')} />} label="Issues" value={fmtCount(kpis.total)} />
            <MetricCard icon={<Activity size={16} color={toneColor('critical')} />} label="Unresolved" value={fmtCount(kpis.unresolved)} />
            <MetricCard icon={<TrendingUp size={16} color={toneColor('warning')} />} label="Regressed" value={fmtCount(kpis.regressed)} />
            <MetricCard icon={<Activity size={16} color={toneColor('neutral')} />} label="Events" value={fmtCount(kpis.events)} />
            <MetricCard icon={<Users size={16} color={toneColor('neutral')} />} label="Users affected" value={fmtCount(kpis.users)} />
            {slices.length > 0 ? (
              <Card p="$3.5" borderWidth={1} borderColor="$borderColor" items="center" justify="center" minW={172}>
                <Donut slices={slices} size={120} thickness={16} legend center={<Text fontSize="$2" color="$color11">by level</Text>} />
              </Card>
            ) : null}
          </XStack>

          <DataTable<SentryIssue>
            columns={columns}
            rows={issues}
            loading={state.phase === 'loading'}
            empty={`No ${STATUS_TABS[tab].status || ''} issues in this window — nothing has errored in scope.`}
            rowKey={(r) => r.id}
            onRowPress={(r) => open(r.id)}
          />
        </>
      )}
    </YStack>
  )
}
