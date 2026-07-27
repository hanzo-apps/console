'use client'

/**
 * HSM — hardware security modules that back key custody (PKCS#11 partitions,
 * cloud-KMS HSM backends) for the platform's signing and encryption keys.
 *
 * Reads the configured HSM backends from the PaaS via the same-origin `/paas`
 * proxy (`GET /v1/hsm`), which injects the service token server-side. When the
 * HSM service isn't provisioned for the org the list load fails and the honest
 * not-configured / unavailable card renders instead of an empty grid — matching
 * every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

type Hsm = {
  id: string
  name?: string
  type?: string
  status?: string
  keys?: number
  region?: string
}

export function HsmModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Hsm[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ hsms?: Hsm[] }>(paas('hsm'))
      setRows(r.hsms ?? [])
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

  const columns: Column<Hsm>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (h) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {h.name || h.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 150,
      render: (h) => (
        <Text fontSize="$3" color="$color11">
          {h.type || '—'}
        </Text>
      ),
    },
    {
      key: 'region',
      header: 'Region',
      width: 130,
      render: (h) => (
        <Text fontSize="$3" color="$color11">
          {h.region || '—'}
        </Text>
      ),
    },
    {
      key: 'keys',
      header: 'Keys',
      width: 90,
      render: (h) => (
        <Text fontSize="$3" color="$color11">
          {h.keys ?? 0}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (h) => <StatusTag status={h.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="HSM"
        subtitle="Hardware security modules — key custody backends."
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
          rowKey={(h) => h.id}
          empty="No HSM backends configured yet."
        />
      )}
    </>
  )
}
