'use client'

/**
 * Status — live health of every Hanzo workload, from REAL data only.
 *
 * Source: the PaaS control plane's workload / drift board (GET /v1/apps) via the
 * same-origin `/paas` proxy. One row = one running app, carrying its own cluster,
 * namespace and computed health — a deployment IS a running service, and its
 * health is its real health. Nothing is fabricated; every non-ready condition
 * (loading, not-configured 501, error, empty) is a real state.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { AppsApi, healthLabel, type App } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; rows: App[] }

/** A workload is "up" when the drift board reports it green (healthy). */
const isUp = (a: App): boolean => (a.health ?? '').toLowerCase() === 'green'

export function StatusModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AppsApi.listApps()
      .then((rows) => setState({ phase: 'ready', rows }))
      .catch((e) => setState({ phase: 'error', error: interpretPlatformError(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<App>[] = [
    {
      key: 'name',
      header: 'Service',
      render: (a) => (
        <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
          {a.app}
        </Text>
      ),
    },
    {
      key: 'env',
      header: 'Env',
      width: 90,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.env}
        </Text>
      ),
    },
    {
      key: 'namespace',
      header: 'Namespace',
      width: 150,
      render: (a) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {a.namespace ?? '—'}
        </Text>
      ),
    },
    {
      key: 'cluster',
      header: 'Cluster',
      width: 150,
      render: (a) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {a.cluster ?? '—'}
        </Text>
      ),
    },
    {
      key: 'tag',
      header: 'Running',
      width: 120,
      render: (a) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {a.runningTag ?? '—'}
        </Text>
      ),
    },
    { key: 'status', header: 'Health', width: 110, render: (a) => <StatusTag status={healthLabel(a.health)} /> },
  ]

  return (
    <>
      <PageHeader
        title="Status"
        subtitle="Live health of every Hanzo workload."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Probing workloads…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <PlatformStateCard error={state.error} onRetry={load} />
      ) : (
        <>
          {state.rows.length > 0 ? (
            <XStack gap="$3" flexWrap="wrap">
              <Stat label="Services" value={state.rows.length} />
              <Stat label="Up" value={state.rows.filter(isUp).length} />
              <Stat label="Clusters" value={new Set(state.rows.map((r) => r.cluster ?? '—')).size} />
            </XStack>
          ) : null}

          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(a) => a.id}
            empty="No workloads observed yet."
          />
        </>
      )}
    </>
  )
}

/** A small headline number (services / up / clusters). */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor" minW={120}>
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$7" fontWeight="800">
        {value}
      </Text>
    </Card>
  )
}
