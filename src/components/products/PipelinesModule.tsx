'use client'

/**
 * Pipelines — CI pipelines (build, test, deploy) tracked per repository.
 *
 * Reads the pipeline list from the unified cloud binary via the same-origin
 * user-bearer `/v1` proxy (`GET /v1/platform/pipelines`), org resolved from the Bearer
 * owner. This is a derived, read-only aggregate; when the backend doesn't serve it
 * the load fails and the honest not-configured / unavailable card renders instead of
 * an empty grid.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, cloudProxyV1Url } from '~/lib/api/client'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'
import { DataTable, PageHeader, StatusTag, type Column } from '@hanzo/ui/product'

type Pipeline = {
  id: string
  name?: string
  repo?: string
  status?: string
  lastRun?: string
  duration?: string
}

export function PipelinesModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ pipelines?: Pipeline[] }>(cloudProxyV1Url('platform/pipelines'))
      setRows(r.pipelines ?? [])
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

  const columns: Column<Pipeline>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {p.name || p.id}
        </Text>
      ),
    },
    {
      key: 'repo',
      header: 'Repo',
      width: 200,
      render: (p) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {p.repo || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (p) => <StatusTag status={p.status ?? 'unknown'} />,
    },
    {
      key: 'lastRun',
      header: 'Last run',
      width: 190,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {p.lastRun ? new Date(p.lastRun).toLocaleString() : '—'}
        </Text>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      width: 110,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {p.duration || '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Pipelines"
        subtitle="CI pipelines — build, test, and deploy per repository."
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
          rowKey={(p) => p.id}
          empty="No pipelines configured yet."
        />
      )}
    </>
  )
}
