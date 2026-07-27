'use client'

/**
 * Settlement — outbound payouts (settlement of balances to a bank account or card),
 * tracked by the commerce billing ledger.
 *
 * Reads the payout ledger from commerce via the same-origin commerce billing proxy
 * (`GET /v1/billing/payouts` → commerce `ListPayouts`), which injects the commerce
 * service token server-side and scopes every read to the caller's OWN org namespace
 * (server-resolved `X-Org-Id`, never client-supplied). The endpoint returns a bare
 * array of payout objects `[{ id, amount, currency, status, destinationType,
 * destinationId, created, ... }]`; amount is in minor units (cents). When the org has
 * no payouts the list is honest-empty; when commerce is unreachable / unconfigured
 * (COMMERCE_TOKEN unset → 501) the honest not-configured / unavailable card renders
 * instead of a fake grid — matching every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, billingProxyV1Url } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

/** Per-tenant billing DATA path — the console's OWN canonical `/v1/billing/*` proxy
 *  (service token + server-pinned org), one builder. See `billingProxyV1Url`. */
const billing = (path: string) => billingProxyV1Url(path.replace(/^\/+/, ''))

/** One payout as commerce's `ListPayouts` returns it (`payoutResponse`). */
type Payout = {
  id: string
  amount?: number // minor units (cents)
  currency?: string
  status?: string
  destinationType?: string // "bank_account" | "card"
  destinationId?: string
  created?: string // RFC3339
  description?: string
}

/** Cents + currency → a human money string (e.g. `1234` usd → "$12.34"). */
const fmtAmount = (cents?: number, currency?: string): string => {
  if (typeof cents !== 'number') return '—'
  const cur = (currency || 'usd').toUpperCase()
  const value = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${value} ${cur}`
}

export function SettlementModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Payout[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // `ListPayouts` returns a BARE array (not the `{ payouts: [...] }` envelope).
      const r = await restGet<Payout[]>(billing('payouts'))
      setRows(Array.isArray(r) ? r : [])
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

  const columns: Column<Payout>[] = [
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
      key: 'destinationType',
      header: 'Type',
      width: 140,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {s.destinationType || '—'}
        </Text>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: 150,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {fmtAmount(s.amount, s.currency)}
        </Text>
      ),
    },
    {
      key: 'destinationId',
      header: 'Destination',
      width: 220,
      render: (s) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {s.destinationId || '—'}
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
      key: 'created',
      header: 'Created',
      width: 190,
      render: (s) => (
        <Text fontSize="$3" color="$color11">
          {s.created ? new Date(s.created).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Settlement"
        subtitle="Outbound payouts — settlement of balances to bank or card."
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
          empty="No payouts yet."
        />
      )}
    </>
  )
}
