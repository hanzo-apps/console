'use client'

/**
 * Indexer — chain indexers tracking block and event indexing status per network
 * (current height, lag behind chain head, health) reported by the platform.
 *
 * Reads the indexer registry from the cloud API via the same-origin `/v1`
 * user-bearer proxy (`GET /v1/indexers`), which mints + forwards the caller's IAM
 * bearer server-side. When the indexer isn't reachable the list load fails and the
 * honest not-configured / unavailable card renders instead of an empty grid —
 * matching every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, cloudProxyV1Url } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type Indexer = {
  id: string
  chain?: string
  network?: string
  height?: string
  lag?: string
  status?: string
  updatedAt?: string
}

export function IndexerModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Indexer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ indexers?: Indexer[] }>(cloudProxyV1Url('indexers'))
      setRows(r.indexers ?? [])
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

  const columns: Column<Indexer>[] = [
    {
      key: 'chain',
      header: 'Chain',
      render: (i) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {i.chain || i.id}
        </Text>
      ),
    },
    {
      key: 'network',
      header: 'Network',
      width: 160,
      render: (i) => (
        <Text fontSize="$3" color="$color11">
          {i.network || '—'}
        </Text>
      ),
    },
    {
      key: 'height',
      header: 'Height',
      width: 120,
      render: (i) => (
        <Text fontSize="$3" color="$color11">
          {i.height || '—'}
        </Text>
      ),
    },
    {
      key: 'lag',
      header: 'Lag',
      width: 100,
      render: (i) => (
        <Text fontSize="$3" color="$color11">
          {i.lag || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (i) => <StatusTag status={i.status ?? 'unknown'} />,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: 190,
      render: (i) => (
        <Text fontSize="$3" color="$color11">
          {i.updatedAt ? new Date(i.updatedAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Indexer"
        subtitle="Chain indexers — block and event indexing status per network."
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
          rowKey={(i) => i.id}
          empty="No indexers running yet."
        />
      )}
    </>
  )
}
