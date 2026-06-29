'use client'

/**
 * Load Balancers — L4/L7 traffic distribution across backend targets (the
 * platform's managed LBs, with their virtual IPs and health-checked pools).
 *
 * Reads the load-balancer inventory from the PaaS via the same-origin `/paas`
 * proxy (`GET /v1/load-balancers`), which injects the service token server-side.
 * When the load-balancer service isn't provisioned for the org the list load
 * fails and the honest not-configured / unavailable card renders instead of an
 * empty grid — matching every other infra module.
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

type LoadBalancer = {
  id: string
  name?: string
  type?: string
  targets?: number
  ip?: string
  status?: string
}

export function LoadBalancerModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<LoadBalancer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ loadBalancers?: LoadBalancer[] }>(paas('load-balancers'))
      setRows(r.loadBalancers ?? [])
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

  const columns: Column<LoadBalancer>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (lb) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {lb.name || lb.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 110,
      render: (lb) => (
        <Text fontSize="$3" color="$color11">
          {lb.type || '—'}
        </Text>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      width: 150,
      render: (lb) => (
        <Text fontSize="$3" color="$color11">
          {lb.ip || '—'}
        </Text>
      ),
    },
    {
      key: 'targets',
      header: 'Targets',
      width: 100,
      render: (lb) => (
        <Text fontSize="$3" color="$color11">
          {lb.targets ?? 0}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (lb) => <StatusTag status={lb.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Load Balancers"
        subtitle="L4/L7 traffic distribution."
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
          rowKey={(lb) => lb.id}
          empty="No load balancers yet."
        />
      )}
    </>
  )
}
