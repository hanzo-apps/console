'use client'

/**
 * Status — the live health of every Hanzo platform service, from REAL data only.
 *
 * Source: the fleet availability read (`/v1/o11y/availability`, HIP-0139). The prober
 * asks each service its OWN health URL every 30 seconds, so "Healthy" means a server
 * answered and "Down" means it did not — nothing is fabricated, and a collection
 * failure is never scored as a service being down. It reports a service and a verdict:
 * there is no per-replica identity under it, because a Service address is not a pod.
 *
 * Every other condition is honest too: loading, access (401/403), an unreachable store
 * (503, which says it cannot see rather than showing an all-down fleet), and error.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { CheckCircle2, RefreshCw, TriangleAlert, XCircle } from '@hanzogui/lucide-icons-2'

import { ApiError, TelemetryApi, type Availability, type ServiceHealth } from '~/lib/api'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; status: number; message: string }
  | { phase: 'ready'; fleet: Availability }

export function StatusModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    TelemetryApi.availability()
      .then((fleet) => setState({ phase: 'ready', fleet }))
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
      key: 'name',
      header: 'Service',
      render: (r) => (
        <XStack items="center" gap="$2" minW={0}>
          {r.up ? <CheckCircle2 size={15} color="$green10" /> : <XCircle size={15} color="$red10" />}
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {r.name}
          </Text>
        </XStack>
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
          <XStack gap="$3" flexWrap="wrap">
            <Stat label="Services" value={state.fleet.total} />
            <Stat label="Healthy" value={state.fleet.up} tone="$green10" />
            <Stat
              label="Down"
              value={state.fleet.total - state.fleet.up}
              tone={state.fleet.total > state.fleet.up ? '$red10' : undefined}
            />
          </XStack>

          <DataTable
            columns={columns}
            rows={state.fleet.services}
            rowKey={(r) => r.name}
            empty="No services observed — the prober is not watching any targets yet."
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

/**
 * Honest failure card — 401 sign-in, 403 platform access, 503 the store cannot be
 * reached, else the real error. The 503 branch says the fleet cannot be SEEN rather
 * than showing every service down, which is what an empty read would look like.
 */
function StatusError({ status, message, onRetry }: { status: number; message: string; onRetry: () => void }) {
  const title =
    status === 401
      ? 'Sign in to view platform status'
      : status === 403
        ? 'Platform administrators only'
        : status === 503
          ? 'Service health is unavailable'
          : 'Could not read service health'
  const body =
    status === 401
      ? 'Platform status is available to signed-in users. Please sign in.'
      : status === 403
        ? 'Fleet status covers every service rather than any one tenant, so it is restricted to platform administrators.'
        : status === 503
          ? 'The telemetry store is not answering, so which services are up cannot be read right now. This is a gap in the view, not a fleet that is down.'
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
      {status !== 401 && status !== 403 ? (
        <Button size="$2" self="flex-start" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
