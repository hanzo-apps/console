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
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

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
      const r = await restGet<{ nodes?: EdgeNode[] }>(paas('edge/nodes'))
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

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(n) => n.id}
          empty="No edge nodes yet."
        />
      )}
    </>
  )
}
