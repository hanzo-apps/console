'use client'

/**
 * Issue detail — the sampled occurrence for one issue over `/v1/sentry/issues/:id`:
 * stack trace (frames + source context), breadcrumbs, tags, environment/release,
 * a deep-link to the linked trace (Traces), resolve/ignore/reopen actions, and the
 * occurrence timeline from `/v1/sentry/issues/:id/events`. Honest states throughout
 * (loading / shared `ErrorState` / honest empties) — never a fabricated frame.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, CheckCircle2, EyeOff, GitBranch, RefreshCw, Route } from '@hanzogui/lucide-icons-2'

import { SentryApi, type IssueStatus, type SentryEvent, type SentryIssueDetail } from '~/lib/api/sentry'
import { ErrorState, asApiError } from '~/components/ui/States'
import { Pill, Fact } from './parts'
import { levelColor, statusTone, fmtWhen, fmtDateTime, fmtCount } from './logic'
import { toneColor, toneVar } from '~/components/ui/tone'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

export function IssueDetailPanel({ id }: { id: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState<SentryIssueDetail | null>(null)
  const [events, setEvents] = useState<SentryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, ev] = await Promise.all([SentryApi.issue(id), SentryApi.issueEvents(id).catch(() => [])])
      setDetail(d)
      setEvents(ev)
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

  const act = useCallback(
    async (status: IssueStatus) => {
      try {
        const updated = await SentryApi.updateIssue(id, status)
        setDetail((d) => (d ? { ...d, issue: updated } : d))
      } catch {
        void load()
      }
    },
    [id, load],
  )

  const issue = detail?.issue ?? null
  const ev = detail?.latestEvent ?? null

  const eventColumns: Column<SentryEvent>[] = [
    { key: 'timestamp', header: 'When', width: 150, render: (e) => <Text fontSize="$2" color="$color11">{fmtDateTime(e.timestamp)}</Text> },
    { key: 'level', header: 'Level', width: 90, render: (e) => <Pill label={e.level} tone={levelColor(e.level)} /> },
    { key: 'environment', header: 'Env', width: 110, render: (e) => <Text fontSize="$2" color="$color11">{e.environment || '—'}</Text> },
    { key: 'release', header: 'Release', width: 130, render: (e) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{e.release || '—'}</Text> },
    { key: 'id', header: 'Event', render: (e) => <Text fontSize="$2" color="$color10" className="hz-mono" numberOfLines={1}>{e.id}</Text> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title={issue?.type || 'Issue'}
        subtitle={issue?.value || issue?.culprit || 'Issue detail'}
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button icon={<ArrowLeft size={16} />} onPress={() => router.push('/sentry')}>
              Issues
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
            {issue && issue.status !== 'resolved' ? (
              <Button size="$3" icon={<CheckCircle2 size={15} />} onPress={() => void act('resolved')}>
                Resolve
              </Button>
            ) : issue ? (
              <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void act('unresolved')}>
                Reopen
              </Button>
            ) : null}
            {issue && issue.status !== 'ignored' ? (
              <Button size="$3" chromeless icon={<EyeOff size={15} />} onPress={() => void act('ignored')}>
                Ignore
              </Button>
            ) : null}
          </XStack>
        }
      />

      {error ? (
        <ErrorState err={asApiError(error)} onRetry={() => void load()} />
      ) : loading && !issue ? (
        <YStack p="$6" items="center">
          <Spinner />
        </YStack>
      ) : issue ? (
        <>
          <XStack gap="$2" flexWrap="wrap">
            <Pill label={`level ${issue.level}`} tone={levelColor(issue.level)} />
            <Pill label={issue.status} tone={statusTone(issue.status)} />
            {issue.regressed ? <Pill label="regressed" tone={toneVar('warning')} /> : null}
            {issue.project ? <Pill label={issue.project} tone={toneVar('neutral')} /> : null}
            {(ev?.environment || issue.environment) ? <Pill label={ev?.environment || issue.environment} tone={toneVar('muted')} /> : null}
            {(ev?.release || issue.release) ? <Pill label={`release ${ev?.release || issue.release}`} tone={toneVar('muted')} /> : null}
          </XStack>

          <Card p="$4" borderWidth={1} borderColor="$borderColor">
            <XStack gap="$4" flexWrap="wrap">
              <Fact label="Events" value={fmtCount(issue.count)} />
              <Fact label="Users" value={issue.userCount ? fmtCount(issue.userCount) : '—'} />
              <Fact label="First seen" value={fmtWhen(issue.firstSeen)} />
              <Fact label="Last seen" value={fmtWhen(issue.lastSeen)} />
              {ev?.transaction ? <Fact label="Transaction" value={ev.transaction} /> : null}
              {ev?.serverName ? <Fact label="Server" value={ev.serverName} /> : null}
            </XStack>
            {ev?.traceId ? (
              <XStack mt="$3">
                <Button size="$2.5" icon={<Route size={15} />} onPress={() => router.push(`/sentry/traces/${encodeURIComponent(ev.traceId)}`)}>
                  View linked trace
                </Button>
              </XStack>
            ) : null}
          </Card>

          <StackTrace event={ev} />
          <Breadcrumbs event={ev} />
          <TagsCard event={ev} />

          <YStack gap="$2">
            <Text fontSize="$4" fontWeight="600" color="$color12">
              Occurrences
            </Text>
            <DataTable<SentryEvent>
              columns={eventColumns}
              rows={events}
              loading={loading}
              rowKey={(e) => e.id}
              empty="No individual occurrences recorded for this issue yet."
            />
          </YStack>
        </>
      ) : (
        <Card p="$4" borderWidth={1} borderColor="$borderColor">
          <Text color="$color11">This issue no longer exists, or hasn’t been seen in the selected window.</Text>
        </Card>
      )}
    </YStack>
  )
}

/** The stack trace — frames newest (crash) first, in-app highlighted, with source context. */
function StackTrace({ event }: { event: SentryEvent | null }) {
  if (!event || event.frames.length === 0) {
    return event ? (
      <YStack gap="$1.5">
        <Text fontSize="$4" fontWeight="600" color="$color12">
          Stack trace
        </Text>
        <Text fontSize="$2" color="$color10">
          No stack trace on the latest event.
        </Text>
      </YStack>
    ) : null
  }
  const frames = event.frames.slice().reverse()
  return (
    <YStack gap="$1.5">
      <Text fontSize="$4" fontWeight="600" color="$color12">
        Stack trace
      </Text>
      <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
        {frames.map((f, i) => (
          <YStack key={i} borderTopWidth={i === 0 ? 0 : 1} borderColor="$borderColor" bg={f.inApp ? '$color2' : undefined}>
            <XStack py="$1.5" px="$2.5" gap="$2" items="baseline">
              <Text fontSize="$1" color="$color10" className="hz-mono" width={20}>
                {i}
              </Text>
              <YStack minW={0} flex={1}>
                <Text fontSize="$2" color="$color12" className="hz-mono" numberOfLines={1}>
                  {f.function}
                </Text>
                <Text fontSize="$1" color="$color10" className="hz-mono" numberOfLines={1}>
                  {(f.module || f.filename || '')}{f.lineno ? `:${f.lineno}` : ''}{f.colno ? `:${f.colno}` : ''}
                </Text>
              </YStack>
              {f.inApp ? (
                <Text fontSize="$1" color={toneColor('neutral')}>
                  in app
                </Text>
              ) : null}
            </XStack>
            {f.context.length > 0 ? (
              <YStack px="$2.5" pb="$2" style={{ overflowX: 'auto' }}>
                <YStack bg="$color1" rounded="$2" borderWidth={1} borderColor="$borderColor" overflow="hidden" minW={280}>
                  {f.context.map(([ln, code]) => {
                    const crash = ln === f.lineno
                    return (
                      <XStack key={ln} gap="$2" px="$2" py={1} bg={crash ? 'rgba(220,220,220,0.14)' : undefined}>
                        <Text fontSize="$1" color="$color10" className="hz-mono" width={36} text="right">
                          {ln}
                        </Text>
                        <Text fontSize="$1" color={crash ? toneColor('critical') : '$color11'} className="hz-mono" style={{ whiteSpace: 'pre' }}>
                          {code}
                        </Text>
                      </XStack>
                    )
                  })}
                </YStack>
              </YStack>
            ) : null}
          </YStack>
        ))}
      </YStack>
    </YStack>
  )
}

/** Breadcrumbs — the events leading up to the crash, oldest→newest. */
function Breadcrumbs({ event }: { event: SentryEvent | null }) {
  if (!event || event.breadcrumbs.length === 0) return null
  return (
    <YStack gap="$1.5">
      <Text fontSize="$4" fontWeight="600" color="$color12">
        Breadcrumbs
      </Text>
      <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
        {event.breadcrumbs.map((b, i) => (
          <XStack key={i} py="$1.5" px="$2.5" gap="$2.5" items="center" borderTopWidth={i === 0 ? 0 : 1} borderColor="$borderColor">
            <YStack width={7} height={7} rounded="$10" style={{ backgroundColor: levelColor(b.level) }} />
            <Text fontSize="$1" color="$color10" width={64} numberOfLines={1}>
              {b.category || b.type || '—'}
            </Text>
            <Text fontSize="$2" color="$color12" flex={1} numberOfLines={1} className="hz-mono">
              {b.message || '—'}
            </Text>
            <Text fontSize="$1" color="$color10">
              {b.timestamp ? fmtWhen(b.timestamp) : ''}
            </Text>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

/** Tags — the searchable key/value context on the event. */
function TagsCard({ event }: { event: SentryEvent | null }) {
  if (!event || event.tags.length === 0) return null
  return (
    <YStack gap="$1.5">
      <XStack items="center" gap="$2">
        <GitBranch size={15} color="var(--color11)" />
        <Text fontSize="$4" fontWeight="600" color="$color12">
          Tags
        </Text>
      </XStack>
      <XStack gap="$2" flexWrap="wrap">
        {event.tags.map((t) => (
          <XStack key={t.key} borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
            <Text fontSize="$1" color="$color10" px="$2" py="$1" bg="$color2">
              {t.key}
            </Text>
            <Text fontSize="$1" color="$color12" px="$2" py="$1" className="hz-mono" numberOfLines={1}>
              {t.value || '—'}
            </Text>
          </XStack>
        ))}
      </XStack>
    </YStack>
  )
}
