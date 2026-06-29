'use client'

/**
 * Settlement — batch settlement of on-chain transfers and payouts (amount,
 * counterparty, status) tracked by the platform.
 *
 * Reads the settlement ledger from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/settlement`), which injects the service token server-side. When the
 * settlement service isn't provisioned for the org the list load fails and the
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

type Settlement = {
  id: string
  type?: string
  amount?: string
  counterparty?: string
  status?: string
  createdAt?: string
}

export function SettlementModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ settlements?: Settlement[] }>(paas('settlement'))
      setRows(r.settlements ?? [])
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

  const columns: Column<Settlement>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (s) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {s.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 140,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {s.type || '—'}
        </Text>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: 140,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {s.amount || '—'}
        </Text>
      ),
    },
    {
      key: 'counterparty',
      header: 'Counterparty',
      width: 200,
      render: (s) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {s.counterparty || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (s) => <StatusTag status={s.status ?? 'unknown'} />,
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: 190,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Settlement"
        subtitle="Batch settlement of on-chain transfers and payouts."
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
          rowKey={(s) => s.id}
          empty="No settlement runs yet."
        />
      )}
    </>
  )
}
