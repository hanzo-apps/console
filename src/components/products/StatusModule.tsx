'use client'

/**
 * Status — the health of every Hanzo service, from REAL data only.
 *
 * Source: the Hanzo PaaS control plane (platform.hanzo.ai) through the
 * same-origin `/paas` proxy. We list the clusters, then each cluster's
 * Kubernetes deployments; a deployment IS a running service, and its ready
 * count / status is its real health. Nothing is fabricated — there are no fake
 * green dots, only what the cluster actually reports. Every other condition is
 * an honest state: loading, not-configured (proxy 501), backend-not-available
 * (404), upstream error, and empty (no clusters) are all real.
 *
 * Composition over a new client: it reuses the SAME `PlatformApi.listClusters` +
 * `KubernetesApi.listResource` the Clusters/Kubernetes modules use, and the SAME
 * honest-state card — one way to read the platform.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { PlatformApi, KubernetesApi, type Cluster, type K8sObject } from '~/lib/api'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

/** One service row = one Kubernetes deployment, tagged with its cluster. */
type ServiceRow = K8sObject & { cluster: string }

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: PlatformError }
  | { phase: 'ready'; rows: ServiceRow[]; partial: string[] }

const clusterId = (c: Cluster): string => c.id ?? c.name

/** Health string for a deployment: explicit status, else derived from "a/b" ready. */
const health = (o: K8sObject): string => {
  if (o.status) return o.status
  const r = o.ready
  if (typeof r === 'string' && r.includes('/')) {
    const [a, b] = r.split('/')
    return a === b && a !== '0' ? 'ready' : 'degraded'
  }
  return o.phase ?? 'unknown'
}

const isUp = (o: K8sObject): boolean => /ready|available|running|ok/i.test(health(o))

export function StatusModule(_props: { params: Record<string, string> }) {
  const org = config.iamOrgName
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PlatformApi.listClusters()
      .then(async (clusters) => {
        const list = clusters ?? []
        const rows: ServiceRow[] = []
        const partial: string[] = []
        await Promise.all(
          list.map(async (c) => {
            try {
              const deps = await KubernetesApi.listResource(org, clusterId(c), 'deployments')
              for (const d of deps) rows.push({ ...d, cluster: c.name })
            } catch {
              partial.push(c.name)
            }
          }),
        )
        setState({ phase: 'ready', rows, partial })
      })
      .catch((e) => setState({ phase: 'error', error: interpretPlatformError(e) }))
  }, [org])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<ServiceRow>[] = [
    {
      key: 'name',
      header: 'Service',
      render: (r) => (
        <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
          {r.name ?? '—'}
        </Text>
      ),
    },
    {
      key: 'namespace',
      header: 'Namespace',
      width: 170,
      render: (r) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {r.namespace ?? '—'}
        </Text>
      ),
    },
    {
      key: 'cluster',
      header: 'Cluster',
      width: 170,
      render: (r) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {r.cluster}
        </Text>
      ),
    },
    {
      key: 'ready',
      header: 'Ready',
      width: 90,
      render: (r) => (
        <Text fontSize="$3" color="$color11">
          {r.ready ?? '—'}
        </Text>
      ),
    },
    { key: 'status', header: 'Status', width: 130, render: (r) => <StatusTag status={health(r)} /> },
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
              <Stat label="Up" value={state.rows.filter(isUp).length} />
              <Stat label="Clusters" value={new Set(state.rows.map((r) => r.cluster)).size} />
            </XStack>
          ) : null}

          {state.partial.length > 0 ? (
            <Text fontSize="$2" color="$color10">
              Could not read deployments from: {state.partial.join(', ')}.
            </Text>
          ) : null}

          <DataTable
            columns={columns}
            rows={state.rows}
            rowKey={(r) => `${r.cluster}/${r.namespace ?? '-'}/${r.name ?? '-'}`}
            empty="No clusters yet — provision one under Deploy → Clusters to see service health."
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
