'use client'

/**
 * Errors (Issues) — Sentry-class error/crash tracking, folded into the ONE o11y
 * plane. Reads the o11y `errortracking` module over the SAME version-less,
 * IAM-scoped `/v1/o11y/*` BFF as Service Map / Logs (`ErrorTrackingApi`,
 * lib/api/apm.ts): grouped issues by fingerprint with lifecycle (resolve / ignore /
 * reopen). Org scope is server-enforced; every KPI, slice and row is a fold over
 * what the runtime returned — an empty result is an honest empty state, never a
 * fabricated error. When the runtime is not initialized (503) / unrouted (404) /
 * not enabled for the org (403) / the session lapsed (401) it shows the shared
 * `RuntimeNotice`, never placeholder issues.
 *
 * Tap-to-act: click an issue row → a detail rail with its latest occurrence,
 * stack trace, trace link, and resolve/ignore/reopen actions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, AlertTriangle, CheckCircle2, EyeOff, RefreshCw, TrendingUp } from '@hanzogui/lucide-icons-2'

import { ErrorTrackingApi, type Issue, type IssueDetail, type IssueStatus } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { SlideOver } from '~/components/ui/SlideOver'
import { Donut, type Slice } from '~/components/ui/Charts'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { levelColor, statusTone } from './sentry/logic'
import { toneColor } from '~/components/ui/tone'
import { toneVar } from '~/components/ui/tone-var'

/** Status filter tabs (label → the query value; '' = all). */
const TABS: { label: string; status: '' | IssueStatus }[] = [
  { label: 'Unresolved', status: 'unresolved' },
  { label: 'All', status: '' },
  { label: 'Resolved', status: 'resolved' },
  { label: 'Ignored', status: 'ignored' },
]

type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; issues: Issue[] }

function summarize(issues: Issue[]) {
  const unresolved = issues.filter((i) => i.status === 'unresolved').length
  const regressed = issues.filter((i) => i.regressed).length
  const events = issues.reduce((s, i) => s + i.count, 0)
  return { total: issues.length, unresolved, regressed, events }
}

/** Issues grouped by severity level → donut slices (real counts only). */
function levelSlices(issues: Issue[]): Slice[] {
  const by = new Map<string, number>()
  for (const i of issues) by.set(i.level, (by.get(i.level) ?? 0) + 1)
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([level, value]) => ({ label: level, value, color: levelColor(level) }))
}

function fmtWhen(iso: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

export function ErrorsModule({ params }: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [tab, setTab] = useState(0)
  const [detail, setDetail] = useState<IssueDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (statusIdx: number) => {
    setState({ phase: 'loading' })
    try {
      const issues = await ErrorTrackingApi.listIssues({ status: TABS[statusIdx].status, sort: 'lastSeen', limit: 100 })
      setState({ phase: 'ready', issues })
    } catch (e) {
      setState({ phase: 'error', error: e })
    }
  }, [])

  const openIssue = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetail({ issue: null, latestEvent: null })
    try {
      setDetail(await ErrorTrackingApi.getIssue(id))
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(tab)
  }, [load, tab])

  // Deep link /errors/:id opens that issue's detail rail on mount.
  useEffect(() => {
    if (params.id) void openIssue(params.id)
  }, [params.id, openIssue])

  const act = useCallback(
    async (id: string, status: IssueStatus) => {
      const updated = await ErrorTrackingApi.updateIssue(id, { status })
      setDetail((d) => (d?.issue?.id === id ? { ...d, issue: updated } : d))
      void load(tab)
    },
    [load, tab],
  )

  const columns: Column<Issue>[] = useMemo(
    () => [
      {
        key: 'issue',
        header: 'Issue',
        render: (r) => (
          <YStack gap="$0.5" minW={0}>
            <XStack gap="$2" items="center">
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
              {r.value || r.culprit || '—'}
            </Text>
            {r.culprit ? (
              <Text fontSize="$1" color="$color10" numberOfLines={1} className="hz-mono">
                {r.culprit}
              </Text>
            ) : null}
          </YStack>
        ),
      },
      { key: 'count', header: 'Events', width: 88, align: 'right', mono: true, render: (r) => <Text className="hz-mono">{r.count}</Text> },
      { key: 'serviceName', header: 'Service', width: 150, render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.serviceName || '—'}</Text> },
      { key: 'lastSeen', header: 'Last seen', width: 110, render: (r) => <Text fontSize="$2" color="$color11">{fmtWhen(r.lastSeen)}</Text> },
      {
        key: 'status',
        header: 'Status',
        width: 110,
        render: (r) => (
          <Text fontSize="$2" fontWeight="500" style={{ color: statusTone(r.status) }}>
            {r.status}
          </Text>
        ),
      },
    ],
    [],
  )

  const issues = state.phase === 'ready' ? state.issues : []
  const kpis = summarize(issues)
  const slices = levelSlices(issues)

  return (
    <YStack gap="$4" p="$4" maxW={1200} width="100%" self="center">
      <PageHeader
        title="Errors"
        subtitle="Grouped exceptions and crashes across your services — one issue per fingerprint."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load(tab)}>
            Refresh
          </Button>
        }
      />

      <XStack gap="$2" flexWrap="wrap">
        {TABS.map((t, i) => (
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

      {state.phase === 'error' ? (
        <RuntimeNotice surface="Errors" error={state.error} />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <MetricCard icon={<AlertTriangle size={16} color={toneColor('critical')} />} label="Issues" value={String(kpis.total)} />
            <MetricCard icon={<Activity size={16} color={toneColor('critical')} />} label="Unresolved" value={String(kpis.unresolved)} />
            <MetricCard icon={<TrendingUp size={16} color={toneColor('warning')} />} label="Regressed" value={String(kpis.regressed)} />
            <MetricCard icon={<Activity size={16} color={toneColor('neutral')} />} label="Events" value={String(kpis.events)} />
            {slices.length > 0 ? (
              <Card p="$3.5" borderWidth={1} borderColor="$borderColor" items="center" justify="center" minW={172}>
                <Donut slices={slices} size={120} thickness={16} legend center={<Text fontSize="$2" color="$color11">by level</Text>} />
              </Card>
            ) : null}
          </XStack>

          <DataTable<Issue>
            columns={columns}
            rows={issues}
            loading={state.phase === 'loading'}
            empty={`No ${TABS[tab].status || ''} issues — nothing has errored in scope.`}
            rowKey={(r) => r.id}
            onRowPress={(r) => void openIssue(r.id)}
          />
        </>
      )}

      <SlideOver
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.issue?.type || 'Issue'}
        icon={AlertTriangle}
        iconColor={toneColor('critical')}
        size={480}
      >
        {detailLoading || !detail?.issue ? (
          <YStack p="$4" items="center">
            <Spinner />
          </YStack>
        ) : (
          <IssueDetailView detail={detail} onAct={act} />
        )}
      </SlideOver>
    </YStack>
  )
}

function IssueDetailView({ detail, onAct }: { detail: IssueDetail; onAct: (id: string, status: IssueStatus) => void }) {
  const issue = detail.issue!
  const ev = detail.latestEvent
  return (
    <YStack gap="$3" p="$3">
      <Text fontSize="$4" fontWeight="600" color="$color12">
        {issue.value || issue.culprit || issue.type}
      </Text>
      {issue.culprit ? (
        <Text fontSize="$2" color="$color11" className="hz-mono">
          {issue.culprit}
        </Text>
      ) : null}

      <XStack gap="$2" flexWrap="wrap">
        <Tag label={`level ${issue.level}`} tone={levelColor(issue.level)} />
        <Tag label={issue.status} tone={statusTone(issue.status)} />
        {issue.regressed ? <Tag label="regressed" tone={toneVar('warning')} /> : null}
        {issue.serviceName ? <Tag label={issue.serviceName} tone={toneVar('neutral')} /> : null}
      </XStack>

      <XStack gap="$3" flexWrap="wrap">
        <Fact label="Events" value={String(issue.count)} />
        <Fact label="First seen" value={fmtWhen(issue.firstSeen)} />
        <Fact label="Last seen" value={fmtWhen(issue.lastSeen)} />
        {issue.environment ? <Fact label="Environment" value={issue.environment} /> : null}
        {issue.release ? <Fact label="Release" value={issue.release} /> : null}
      </XStack>

      <XStack gap="$2" flexWrap="wrap">
        {issue.status !== 'resolved' ? (
          <Button size="$2.5" icon={<CheckCircle2 size={14} />} onPress={() => onAct(issue.id, 'resolved')}>
            Resolve
          </Button>
        ) : (
          <Button size="$2.5" icon={<RefreshCw size={14} />} onPress={() => onAct(issue.id, 'unresolved')}>
            Reopen
          </Button>
        )}
        {issue.status !== 'ignored' ? (
          <Button size="$2.5" chromeless icon={<EyeOff size={14} />} onPress={() => onAct(issue.id, 'ignored')}>
            Ignore
          </Button>
        ) : null}
      </XStack>

      {ev && ev.frames.length > 0 ? (
        <YStack gap="$1.5">
          <Text fontSize="$2" fontWeight="600" color="$color11">
            Stack trace
          </Text>
          <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
            {ev.frames
              .slice()
              .reverse()
              .map((f, i) => (
                <XStack
                  key={i}
                  py="$1.5"
                  px="$2.5"
                  gap="$2"
                  borderTopWidth={i === 0 ? 0 : 1}
                  borderColor="$borderColor"
                  bg={f.inApp ? '$color2' : undefined}
                >
                  <Text fontSize="$1" color="$color10" className="hz-mono" width={18}>
                    {i}
                  </Text>
                  <YStack minW={0} flex={1}>
                    <Text fontSize="$2" color="$color12" className="hz-mono" numberOfLines={1}>
                      {f.function || '<anonymous>'}
                    </Text>
                    <Text fontSize="$1" color="$color10" className="hz-mono" numberOfLines={1}>
                      {(f.module || f.filename || '')}{f.lineno ? `:${f.lineno}` : ''}
                    </Text>
                  </YStack>
                </XStack>
              ))}
          </YStack>
        </YStack>
      ) : ev ? (
        <Text fontSize="$2" color="$color10">
          No stack trace on the latest event.
        </Text>
      ) : null}
    </YStack>
  )
}

function Tag({ label, tone }: { label: string; tone: string }) {
  return (
    <XStack borderWidth={1} borderColor="$borderColor" rounded="$10" px="$2.5" py="$1" items="center" gap="$1.5">
      <YStack width={7} height={7} rounded={99} style={{ backgroundColor: tone }} />
      <Text fontSize="$1" color="$color11">
        {label}
      </Text>
    </XStack>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$0.5" minW={96}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" className="hz-mono">
        {value}
      </Text>
    </YStack>
  )
}
