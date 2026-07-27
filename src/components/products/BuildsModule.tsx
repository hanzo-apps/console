'use client'

/**
 * Builds — image and binary builds and their status.
 *
 * Reads the build list from the unified cloud binary via the same-origin user-bearer
 * `/v1` proxy (`GET /v1/builds`), org resolved from the Bearer owner. This is a
 * derived, read-only aggregate; when the backend doesn't serve it the load fails and
 * the honest not-configured / unavailable card renders instead of an empty grid.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, cloudProxyV1Url } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type Build = {
  id: string
  repo?: string
  commit?: string
  status?: string
  startedAt?: string
  duration?: string
}

export function BuildsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Build[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ builds?: Build[] }>(cloudProxyV1Url('builds'))
      setRows(r.builds ?? [])
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

  const columns: Column<Build>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (b) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {b.id}
        </Text>
      ),
    },
    {
      key: 'repo',
      header: 'Repo',
      width: 200,
      render: (b) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {b.repo || '—'}
        </Text>
      ),
    },
    {
      key: 'commit',
      header: 'Commit',
      width: 120,
      render: (b) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {b.commit || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (b) => <StatusTag status={b.status ?? 'unknown'} />,
    },
    {
      key: 'startedAt',
      header: 'Started',
      width: 190,
      render: (b) => (
        <Text fontSize="$3" color="$color11">
          {b.startedAt ? new Date(b.startedAt).toLocaleString() : '—'}
        </Text>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      width: 110,
      render: (b) => (
        <Text fontSize="$3" color="$color11">
          {b.duration || '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Builds"
        subtitle="Image and binary builds and their status."
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
          rowKey={(b) => b.id}
          empty="No builds yet."
        />
      )}
    </>
  )
}
