'use client'

/**
 * VPC — virtual private clouds providing network isolation (an org's private
 * address space, carved into subnets across regions).
 *
 * Reads the VPC inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/vpcs`), which injects the service token server-side. When the VPC
 * service isn't provisioned for the org the list load fails and the honest
 * not-configured / unavailable card renders instead of an empty grid — matching
 * every other infra module.
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

type Vpc = {
  id: string
  name?: string
  cidr?: string
  region?: string
  subnets?: string[]
  status?: string
}

export function VpcModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Vpc[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ vpcs?: Vpc[] }>(paas('vpcs'))
      setRows(r.vpcs ?? [])
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

  const columns: Column<Vpc>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (v) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {v.name || v.id}
        </Text>
      ),
    },
    {
      key: 'cidr',
      header: 'CIDR',
      width: 150,
      render: (v) => (
        <Text fontSize="$3" color="$color11">
          {v.cidr || '—'}
        </Text>
      ),
    },
    {
      key: 'region',
      header: 'Region',
      width: 130,
      render: (v) => (
        <Text fontSize="$3" color="$color11">
          {v.region || '—'}
        </Text>
      ),
    },
    {
      key: 'subnets',
      header: 'Subnets',
      width: 100,
      render: (v) => (
        <Text fontSize="$3" color="$color11">
          {v.subnets?.length ?? 0}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (v) => <StatusTag status={v.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="VPC"
        subtitle="Virtual private clouds — network isolation."
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
          rowKey={(v) => v.id}
          empty="No VPCs yet."
        />
      )}
    </>
  )
}
