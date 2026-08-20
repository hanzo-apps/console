'use client'

/**
 * Monitor — event-rate + error-rate timeseries over `/v1/sentinel/stats`, per
 * project. Two real series (events received, errors) charted over the window with
 * KPI totals and a derived error rate. Every point is the backend's own count —
 * empty is an honest empty chart, a failed load the shared `ErrorState`.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, AlertTriangle, Percent, RefreshCw } from '@hanzogui/lucide-icons-2'

import { SentryApi, type Period, type StatPoint, type SentryProject } from '~/lib/api/sentry'
import { MetricCard } from '~/components/ui/Metric'
import { Panel } from '~/components/ui/Panel'
import { LineChart, BarChart } from '~/components/ui/Charts'
import { ErrorState, asApiError } from '~/components/ui/States'
import { PeriodPicker, ProjectPicker } from './parts'
import { statsToPoints, statsTotal, fmtCount } from './logic'
import { toneColor, toneVar } from '~/components/ui/tone'
import { PageHeader } from '@hanzo/ui/product'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; events: StatPoint[]; errors: StatPoint[] }

export function StatsPanel({ projects }: { projects: SentryProject[] }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [project, setProject] = useState('')
  const [period, setPeriod] = useState<Period>('24h')

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [events, errors] = await Promise.all([
        SentryApi.stats({ project, period, field: 'received' }),
        SentryApi.stats({ project, period, field: 'errors' }),
      ])
      setState({ phase: 'ready', events, errors })
    } catch (e) {
      setState({ phase: 'error', error: e })
    }
  }, [project, period])

  useEffect(() => {
    void load()
  }, [load])

  const events = state.phase === 'ready' ? state.events : []
  const errors = state.phase === 'ready' ? state.errors : []
  const totalEvents = statsTotal(events)
  const totalErrors = statsTotal(errors)
  const rate = totalEvents > 0 ? (totalErrors / totalEvents) * 100 : 0
  const eventPts = statsToPoints(events)
  const errorPts = statsToPoints(errors)

  return (
    <YStack gap="$4">
      <PageHeader
        title="Monitor"
        subtitle="Event and error rates across your projects over time."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            <ProjectPicker projects={projects} value={project} onChange={setProject} />
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <ErrorState err={asApiError(state.error)} onRetry={() => void load()} />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <MetricCard icon={<Activity size={16} color={toneColor('neutral')} />} label="Events" value={fmtCount(totalEvents)} spark={events.map((p) => p.value)} sparkColor={toneVar('neutral')} />
            <MetricCard icon={<AlertTriangle size={16} color={toneColor('critical')} />} label="Errors" value={fmtCount(totalErrors)} spark={errors.map((p) => p.value)} sparkColor={toneVar('critical')} />
            <MetricCard icon={<Percent size={16} color={toneColor('warning')} />} label="Error rate" value={totalEvents > 0 ? `${rate.toFixed(2)}%` : '—'} />
          </XStack>

          <Panel title="Events received" grow={false}>
            {eventPts.length >= 2 ? (
              <LineChart data={eventPts} height={210} color={toneVar('neutral')} formatValue={(v) => fmtCount(v)} />
            ) : (
              <EmptyChart loading={state.phase === 'loading'} />
            )}
          </Panel>

          <Panel title="Errors" grow={false}>
            {errorPts.length >= 2 ? (
              <BarChart data={errorPts} height={210} color={toneVar('critical')} formatValue={(v) => fmtCount(v)} />
            ) : (
              <EmptyChart loading={state.phase === 'loading'} />
            )}
          </Panel>
        </>
      )}
    </YStack>
  )
}

function EmptyChart({ loading }: { loading: boolean }) {
  return (
    <Card p="$6" items="center" bg="transparent">
      <Text fontSize="$3" color="$color10">
        {loading ? 'Loading…' : 'No data in this window yet. Points appear as your projects report events — pick a longer period above.'}
      </Text>
    </Card>
  )
}
