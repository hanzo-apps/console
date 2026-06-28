'use client'

/**
 * Kubernetes — browse the operator-managed workloads running on each cluster,
 * through the Hanzo PaaS control plane (same-origin `/paas` proxy → `GET /v1/apps`,
 * the apps inventory). Pick a cluster, see its services with declared/running tag
 * and health. The platform exposes the inventory (a workload IS a `Service` CR +
 * its Deployment), not a raw kube-apiserver passthrough, so this shows exactly
 * what the control plane reports — never fabricated pods or fake charts. Every
 * state is honest: loading, not-configured (proxy 501 / token rejected), upstream
 * error, and empty are all real.
 *
 * Reuses the SAME `PlatformApi.apps` source as the Status module (one way to read
 * the platform); it just scopes the view to a chosen cluster.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { PlatformApi, clustersFromApps, type PlatformApp } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { FieldSelect } from '~/components/ui/Field'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; apps: PlatformApp[] }

const columns: Column<PlatformApp>[] = [
  {
    key: 'app',
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
  { key: 'env', header: 'Env', width: 80, render: (a) => <Text fontSize="$3" color="$color11">{a.env}</Text> },
  {
    key: 'declaredTag',
    header: 'Declared',
    width: 140,
    render: (a) => (
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {a.declaredTag ?? '—'}
      </Text>
    ),
  },
  {
    key: 'runningTag',
    header: 'Running',
    width: 140,
    render: (a) => (
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {a.runningTag ?? '—'}
      </Text>
    ),
  },
  { key: 'health', header: 'Health', width: 110, render: (a) => <StatusTag status={a.health} /> },
]

export function KubernetesModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [cluster, setCluster] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PlatformApi.apps()
      .then((apps) => {
        setState({ phase: 'ready', apps })
        setCluster((cur) => cur ?? clustersFromApps(apps)[0] ?? null)
      })
      .catch((e) => setState({ phase: 'error', error: interpretPlatformError(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const clusters = useMemo(
    () => (state.phase === 'ready' ? clustersFromApps(state.apps) : []),
    [state],
  )
  const active = cluster ?? clusters[0] ?? ''
  const rows = useMemo(
    () => (state.phase === 'ready' ? state.apps.filter((a) => a.cluster === active) : []),
    [state, active],
  )

  return (
    <>
      <PageHeader
        title="Kubernetes"
        subtitle="Operator-managed workloads across your clusters."
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
      ) : clusters.length === 0 ? (
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(a) => a.id}
          empty="No workloads observed yet — the control plane has not reported any apps."
        />
      ) : (
        <>
          <XStack gap="$3" items="center" flexWrap="wrap">
            <Text fontSize="$3" color="$color11" fontWeight="600">
              Cluster
            </Text>
            <YStack minW={240}>
              <FieldSelect value={active} options={clusters} onChange={setCluster} />
            </YStack>
            <Text fontSize="$2" color="$color10">
              {rows.length} workload{rows.length === 1 ? '' : 's'}
            </Text>
          </XStack>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            empty="No workloads in this cluster."
          />
        </>
      )}
    </>
  )
}
