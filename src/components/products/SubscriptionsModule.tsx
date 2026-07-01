'use client'

/**
 * Subscriptions — the org's active subscriptions (plan, status, renewal, seats),
 * read from real commerce through the console's own per-tenant `/billing/*` proxy
 * (server-injected service token, scoped to the caller's org — the browser can't
 * widen scope). Read-only: subscribing / changing a plan happens in the brand
 * billing portal (`config.billingUrl`), which the header links to.
 *
 * Honest loading / empty / error states via `BackendStateCard`: a 404/501 on the
 * commerce subscriptions surface degrades the table, never fabricates a plan.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { ExternalLink, RefreshCw } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { BillingApi, type Subscription } from '~/lib/api/billing'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

const usd = (cents?: number): string => (cents != null ? `$${(cents / 100).toFixed(2)}` : '—')

const fmtDate = (s?: string): string => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

function openBillingPortal(): void {
  if (typeof window !== 'undefined') window.open(`${config.billingUrl}/subscriptions`, '_blank', 'noopener')
}

export function SubscriptionsModule(_props: { params: Record<string, string> }) {
  const [subs, setSubs] = useState<Async<Subscription[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setSubs({ phase: 'loading' })
    BillingApi.subscriptions()
      .then((data) => setSubs({ phase: 'ready', data }))
      .catch((e) => setSubs({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<Subscription>[] = [
    {
      key: 'plan',
      header: 'Plan',
      render: (r) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {r.plan}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (r) => (r.status ? <StatusTag status={r.status} /> : <Text fontSize="$3" color="$color10">—</Text>),
    },
    {
      key: 'quantity',
      header: 'Seats',
      width: 90,
      render: (r) => <Text fontSize="$3" color="$color11">{r.quantity ?? '—'}</Text>,
    },
    {
      key: 'cents',
      header: 'Price',
      width: 130,
      render: (r) => (
        <Text fontSize="$3" color="$color12">
          {usd(r.cents)}
          {r.cents != null && r.interval ? <Text fontSize="$2" color="$color10">{` / ${r.interval}`}</Text> : null}
        </Text>
      ),
    },
    {
      key: 'currentPeriodEnd',
      header: 'Renews',
      width: 130,
      render: (r) => <Text fontSize="$3" color="$color11">{fmtDate(r.currentPeriodEnd)}</Text>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Plans your organization is subscribed to — status, seats, and renewal. Manage subscriptions in the billing portal."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" theme="light" iconAfter={<ExternalLink size={14} />} onPress={openBillingPortal}>
              Manage
            </Button>
          </XStack>
        }
      />

      {subs.phase === 'error' ? (
        <BackendStateCard state={subs.error} onRetry={load} hint="endpoint · GET /v1/billing/subscriptions" />
      ) : (
        <DataTable
          columns={columns}
          rows={subs.phase === 'ready' ? subs.data : []}
          loading={subs.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No active subscriptions. Plans you subscribe to appear here."
        />
      )}
    </>
  )
}

export default SubscriptionsModule
