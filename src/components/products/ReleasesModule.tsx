'use client'

/**
 * Releases — versioned deploys recorded per environment.
 *
 * Reads the release history from the unified cloud binary via the same-origin
 * user-bearer `/v1` proxy (`GET /v1/platform/releases`), org resolved from the Bearer
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

type Release = {
  id: string
  name?: string
  version?: string
  environment?: string
  status?: string
  releasedAt?: string
}

export function ReleasesModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ releases?: Release[] }>(cloudProxyV1Url('platform/releases'))
      setRows(r.releases ?? [])
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

  const columns: Column<Release>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {r.name || r.id}
        </Text>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      width: 120,
      render: (r) => (
        <Text fontSize="$3" color="$color11">
          {r.version || '—'}
        </Text>
      ),
    },
    {
      key: 'environment',
      header: 'Environment',
      width: 150,
      render: (r) => (
        <Text fontSize="$3" color="$color11">
          {r.environment || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (r) => <StatusTag status={r.status ?? 'unknown'} />,
    },
    {
      key: 'releasedAt',
      header: 'Released',
      width: 190,
      render: (r) => (
        <Text fontSize="$3" color="$color11">
          {r.releasedAt ? new Date(r.releasedAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Releases"
        subtitle="Versioned deploys per environment."
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
          rowKey={(r) => r.id}
          empty="No releases yet. A release is a version deployed to one environment — deploys are recorded here as they ship."
        />
      )}
    </>
  )
}
