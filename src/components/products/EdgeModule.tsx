'use client'

/**
 * Edge — globally-distributed edge compute nodes run by the platform.
 *
 * Reads the edge-node inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/edge/nodes`), which injects the service token server-side. When the
 * edge service isn't provisioned for the org the list load fails and the
 * honest not-configured / unavailable card renders instead of an empty grid —
 * matching every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack } from '@hanzo/gui'
import { RefreshCw, Radio } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { restGet, originV1Url } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type EdgeNode = {
  id: string
  name?: string
  region?: string
  status?: string
  requests?: string
  latency?: string
}

export function EdgeModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<EdgeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ nodes?: EdgeNode[] }>(originV1Url('edge/nodes'))
      setRows(r.nodes ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<EdgeNode>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (n) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {n.name || n.id}
        </Text>
      ),
    },
    {
      key: 'region',
      header: 'Region',
      width: 140,
      render: (n) => (
        <Text fontSize="$3" color="$color11">
          {n.region || '—'}
        </Text>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      width: 120,
      render: (n) => (
        <Text fontSize="$3" color="$color11">
          {n.requests || '—'}
        </Text>
      ),
    },
    {
      key: 'latency',
      header: 'Latency',
      width: 110,
      render: (n) => (
        <Text fontSize="$3" color="$color11">
          {n.latency || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (n) => <StatusTag status={n.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Edge"
        subtitle="Globally-distributed edge compute nodes."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loading ? (
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      ) : rows.length ? (
        // Real edge nodes reported by the platform → the live inventory.
        <DataTable columns={columns} rows={rows} rowKey={(n) => n.id} empty="No edge nodes yet." />
      ) : loadError && loadError.kind === 'error' ? (
        // A genuine transient failure (not "no backend") → the honest retry card.
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        // Live edge fabric with no nodes tagged to this org yet → an honest empty
        // state (managed by Hanzo), never a fabricated node grid.
        <EmptyState
          icon={Radio}
          title="No edge nodes yet"
          description="Globally-distributed edge compute — run functions and containers close to your users, managed by Hanzo. Nodes tagged to your org appear here as your edge fabric comes online; until then your workloads run on the shared Hanzo Cloud regions."
          bullets={[
            'Deploy once — served from the edge location nearest each request',
            'Backed by the same functions + containers you already run',
            'Nodes and traffic appear here as your edge fabric comes online',
          ]}
          primary={{ label: 'Edge docs', href: `${config.docsUrl}/docs/edge` }}
          secondary={{ label: 'Containers', onPress: () => { if (typeof window !== 'undefined') window.location.assign('/containers') } }}
        />
      )}
    </>
  )
}
