'use client'

/**
 * Status — the health of every Hanzo service, from REAL data only.
 *
 * Source: the Hanzo PaaS control plane (platform.hanzo.ai) through the
 * same-origin `/paas` proxy, `GET /v1/apps` — the apps inventory the control
 * plane already computes (declared/running tag + drift + health per service, per
 * cluster). A row IS a running operator-managed service; its `health`
 * (green/yellow/red) is the real verdict. Nothing is fabricated — there are no
 * fake green dots, only what the cluster actually reports. Every other condition
 * is honest: loading, not-configured (proxy 501 / token rejected), upstream
 * error, and empty are all real.
 *
 * Composition over a new client: it reuses the SAME `PlatformApi.apps` the
 * Kubernetes (workloads) module reads, and the SAME honest-state card — one way
 * to read the platform.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { PlatformApi, type PlatformApp } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; rows: PlatformApp[] }

const isUp = (a: PlatformApp): boolean => a.health === 'green'

export function StatusModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PlatformApi.apps()
      .then((rows) => setState({ phase: 'ready', rows }))
      .catch((e) => setState({ phase: 'error', error: interpretPlatformError(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<PlatformApp>[] = [
    {
      key: 'app',
      header: 'Service',
      render: (r) => (
        <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
          {r.app}
        </Text>
      ),
    },
    {
      key: 'cluster',
      header: 'Cluster',
      width: 150,
      render: (r) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {r.cluster}
        </Text>
      ),
    },
    {
      key: 'namespace',
      header: 'Namespace',
      width: 140,
      render: (r) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {r.namespace ?? '—'}
        </Text>
      ),
    },
    {
      key: 'env',
      header: 'Env',
      width: 80,
      render: (r) => (
        <Text fontSize="$3" color="$color11">
          {r.env}
        </Text>
      ),
    },
    {
      key: 'runningTag',
      header: 'Running',
      width: 150,
      render: (r) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {r.runningTag ?? '—'}
        </Text>
      ),
    },
    { key: 'health', header: 'Health', width: 110, render: (r) => <StatusTag status={r.health} /> },
  ]

  return (
    <>
      <PageHeader
        title="Status"
        subtitle="Live health of every Hanzo service across your clusters."
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
        <PlatformStateCard error={state.error} onRetry={load} />
      ) : (
        <>
          {state.rows.length > 0 ? (
            <XStack gap="$3" flexWrap="wrap">
              <Stat label="Services" value={state.rows.length} />
              <Stat label="Healthy" value={state.rows.filter(isUp).length} />
              <Stat label="Clusters" value={new Set(state.rows.map((r) => r.cluster)).size} />
            </XStack>
          ) : null}

          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(r) => r.id}
            empty="No services observed yet — the control plane has not reported any apps."
          />
        </>
      )}
    </>
  )
}

/** A small headline number (services / healthy / clusters). */
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
