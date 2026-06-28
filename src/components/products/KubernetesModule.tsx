'use client'

/**
 * Kubernetes — the live workloads running across Hanzo's clusters, from the PaaS
 * control plane's workload / drift board (GET /v1/apps) via the same-origin
 * `/paas` proxy. One row per running app with its cluster, namespace, image
 * (running → declared when drifting) and computed health. Every state is honest:
 * loading, not-configured (501), error, and empty are all real — no fabricated
 * rows, no fake charts.
 *
 * Raw per-object browse (pods / services / events / custom resources) is not yet
 * exposed by the platform REST API; this module shows the deployment-level truth
 * the platform actually reports today.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack } from '@hanzo/gui'
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

/** Running image; show "running → declared" when the two drift apart. */
const image = (a: App): string => {
  const r = a.runningTag
  const d = a.declaredTag
  if (r && d && r !== d) return `${r} → ${d}`
  return r ?? d ?? '—'
}

export function KubernetesModule(_props: { params: Record<string, string> }) {
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
      header: 'Workload',
      render: (a) => (
        <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
          {a.app}
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
      key: 'env',
      header: 'Env',
      width: 80,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.env}
        </Text>
      ),
    },
    {
      key: 'image',
      header: 'Image',
      width: 170,
      render: (a) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {image(a)}
        </Text>
      ),
    },
    { key: 'status', header: 'Health', width: 110, render: (a) => <StatusTag status={healthLabel(a.health)} /> },
  ]

  return (
    <>
      <PageHeader
        title="Kubernetes"
        subtitle="Live workloads across Hanzo's clusters."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading workloads…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <PlatformStateCard error={state.error} onRetry={load} />
      ) : (
        <DataTable
          columns={columns}
          rows={state.rows}
          rowKey={(a) => a.id}
          empty="No workloads observed yet."
        />
      )}
    </>
  )
}
