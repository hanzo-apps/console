'use client'

/**
 * Environments — deploy targets (production, staging, development).
 *
 * Reads the environment list from the unified cloud binary via the same-origin
 * user-bearer `/v1` proxy (`GET /v1/platform/environments`), org resolved from the Bearer
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

type Environment = {
  id: string
  name?: string
  type?: string
  status?: string
  services?: string[]
  updatedAt?: string
}

export function EnvironmentsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Environment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ environments?: Environment[] }>(cloudProxyV1Url('platform/environments'))
      setRows(r.environments ?? [])
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

  const columns: Column<Environment>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (e) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {e.name || e.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 130,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {e.type || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (e) => <StatusTag status={e.status ?? 'unknown'} />,
    },
    {
      key: 'services',
      header: 'Services',
      width: 110,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {e.services?.length ?? 0}
        </Text>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: 190,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {e.updatedAt ? new Date(e.updatedAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Environments"
        subtitle="Deploy targets — production, staging, and development."
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
          rowKey={(e) => e.id}
          empty="No environments yet."
        />
      )}
    </>
  )
}
