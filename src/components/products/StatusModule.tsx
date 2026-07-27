'use client'

/**
 * Status — the live health of every Hanzo platform service, from REAL data only.
 *
 * Source: VictoriaMetrics (`up{}`) through the same-origin read-only `/telemetry`
 * proxy. VictoriaMetrics scrapes a health target per service (`up{job="iam-health"}`,
 * `up{job="cloud-api-health"}`, …); `up == 1` is a real, live "healthy" verdict and
 * `up == 0` is a real "down". Nothing is fabricated — there are no fake green dots,
 * only what the TSDB actually reports.
 *
 * Why not `/paas/apps` (the old source): the platform apps inventory reports ZERO
 * apps on this deployment, so that board was empty for admins and "managed by Hanzo"
 * for customers — it showed no health at all. VictoriaMetrics is where the live
 * signal is, and platform status is a status-page concern appropriate for any
 * signed-in user (read-only, no control-plane token). Every other condition is
 * honest: loading, not-configured (proxy 501), access (401), and error.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { CheckCircle2, RefreshCw, TriangleAlert, XCircle } from '@hanzogui/lucide-icons-2'

import { ApiError, TelemetryApi, summarizeHealth, type ServiceHealth } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; status: number; message: string }
  | { phase: 'ready'; rows: ServiceHealth[] }

export function StatusModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    TelemetryApi.serviceHealth()
      .then((rows) => setState({ phase: 'ready', rows }))
      .catch((e) =>
        setState({
          phase: 'error',
          status: e instanceof ApiError ? e.status : 0,
          message: e instanceof Error ? e.message : String(e),
        }),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<ServiceHealth>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (r) => (
        <XStack items="center" gap="$2" minW={0}>
          {r.up ? <CheckCircle2 size={15} color="$green10" /> : <XCircle size={15} color="$red10" />}
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {r.service}
          </Text>
        </XStack>
      ),
    },
    {
      key: 'instance',
      header: 'Endpoint',
      width: 260,
      render: (r) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {r.instance || '—'}
        </Text>
      ),
    },
    {
      key: 'brand',
      header: 'Brand',
      width: 100,
      render: (r) => (
        <Text fontSize="$2" color="$color11">
          {r.brand ?? '—'}
        </Text>
      ),
    },
    {
      key: 'up',
      header: 'Health',
      width: 120,
      render: (r) => (
        <XStack items="center" gap="$1.5">
          <YStack width={8} height={8} rounded="$10" bg={r.up ? '$green10' : '$red10'} />
          <Text fontSize="$2" color={r.up ? '$green11' : '$red11'} fontWeight="600">
            {r.up ? 'Healthy' : 'Down'}
          </Text>
        </XStack>
      ),
    },
  ]

  const summary = state.phase === 'ready' ? summarizeHealth(state.rows) : null

  return (
    <>
      <PageHeader
        title="Status"
        subtitle="Live health of every Hanzo platform service."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Probing services…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <StatusError status={state.status} message={state.message} onRetry={load} />
      ) : (
        <YStack gap="$3">
          {summary ? (
            <XStack gap="$3" flexWrap="wrap">
              <Stat label="Services" value={summary.total} />
              <Stat label="Healthy" value={summary.healthy} tone="$green10" />
              <Stat label="Down" value={summary.down} tone={summary.down > 0 ? '$red10' : undefined} />
            </XStack>
          ) : null}

          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(r) => `${r.job}:${r.instance}`}
            empty="No services observed — the telemetry store has not reported any scrape targets yet."
          />
        </YStack>
      )}
    </>
  )
}

/** A small headline number (services / healthy / down). */
function Stat({ label, value, tone }: { label: string; value: number; tone?: '$green10' | '$red10' }) {
  return (
    <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor" minW={120}>
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$7" fontWeight="800" color={tone ?? '$color12'}>
        {value}
      </Text>
    </Card>
  )
}

/** Honest failure card — 501 not-configured, 401 access, else a real error. */
function StatusError({ status, message, onRetry }: { status: number; message: string; onRetry: () => void }) {
  const title =
    status === 501
      ? 'Telemetry not configured'
      : status === 401
        ? 'Sign in to view platform status'
        : 'Could not reach the telemetry store'
  const body =
    status === 501
      ? 'This console is wired to the telemetry store, but its URL (VM_URL) is not set on this deployment yet. Once it is, live service health appears here — no fabricated status is shown.'
      : status === 401
        ? 'Platform status is available to signed-in users. Please sign in.'
        : message
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {body}
      </Text>
      {status !== 401 ? (
        <Button size="$2" self="flex-start" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
