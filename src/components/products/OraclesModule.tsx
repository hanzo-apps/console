'use client'

/**
 * Oracles — price and data oracles feeding on-chain contracts (push/pull feeds,
 * aggregated values, source provenance) tracked by the platform.
 *
 * Reads the oracle registry from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/oracles`), which injects the service token server-side. When the
 * oracle service isn't provisioned for the org the list load fails and the
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

type Oracle = {
  id: string
  name?: string
  feed?: string
  value?: string
  source?: string
  status?: string
  updatedAt?: string
}

export function OraclesModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Oracle[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ oracles?: Oracle[] }>(paas('oracles'))
      setRows(r.oracles ?? [])
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

  const columns: Column<Oracle>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (o) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {o.name || o.id}
        </Text>
      ),
    },
    {
      key: 'feed',
      header: 'Feed',
      width: 160,
      render: (o) => (
        <Text fontSize="$3" color="$color11">
          {o.feed || '—'}
        </Text>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      width: 140,
      render: (o) => (
        <Text fontSize="$3" color="$color11">
          {o.value || '—'}
        </Text>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      width: 180,
      render: (o) => (
        <Text fontSize="$3" color="$color11">
          {o.source || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (o) => <StatusTag status={o.status ?? 'unknown'} />,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: 190,
      render: (o) => (
        <Text fontSize="$3" color="$color11">
          {o.updatedAt ? new Date(o.updatedAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Oracles"
        subtitle="Price and data oracles feeding on-chain contracts."
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
          rowKey={(o) => o.id}
          empty="No oracles configured yet. Data feeds appear here."
        />
      )}
    </>
  )
}
