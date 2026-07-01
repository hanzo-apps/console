'use client'

/**
 * Invoices — the org's invoice history (`GET /v1/billing/invoices` via the
 * per-tenant `/billing` proxy), with a download/view link when commerce provides a
 * hosted invoice / PDF URL. Read-only; honest loading / empty / error states — a
 * 404/501 degrades to a truthful notice, an org with no closed period shows an
 * honest empty, and no invoice is ever fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { RefreshCw, Download } from '@hanzogui/lucide-icons-2'

import { BillingApi, type Invoice } from '~/lib/api/billing'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const fmtDate = (s?: string): string => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function BillingInvoices(_props: { params: Record<string, string> }) {
  const [invoices, setInvoices] = useState<Async<Invoice[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setInvoices({ phase: 'loading' })
    BillingApi.invoices()
      .then((data) => setInvoices({ phase: 'ready', data }))
      .catch((e) => setInvoices({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<Invoice>[] = [
    { key: 'date', header: 'Date', width: 140, render: (r) => <Text fontSize="$3" color="$color11">{fmtDate(r.date)}</Text> },
    { key: 'id', header: 'Invoice', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{r.id}</Text> },
    { key: 'status', header: 'Status', width: 130, render: (r) => (r.status ? <StatusTag status={r.status} /> : <Text fontSize="$3" color="$color10">—</Text>) },
    { key: 'cents', header: 'Amount', width: 120, render: (r) => <Text fontSize="$3" color="$color12">{usd(r.cents)}</Text> },
    {
      key: 'url',
      header: '',
      width: 120,
      render: (r) =>
        r.url ? (
          <Button
            size="$2"
            chromeless
            icon={<Download size={14} />}
            onPress={() => { if (typeof window !== 'undefined') window.open(r.url, '_blank', 'noopener') }}
          >
            Download
          </Button>
        ) : (
          <Text fontSize="$2" color="$color10">—</Text>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Your billing history. Download a hosted invoice or receipt when one is available."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {invoices.phase === 'error' ? (
        <BackendStateCard state={invoices.error} onRetry={load} hint="endpoint · GET /v1/billing/invoices" />
      ) : (
        <DataTable
          columns={columns}
          rows={invoices.phase === 'ready' ? invoices.data : []}
          loading={invoices.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No invoices yet. Invoices appear here once your first billing period closes."
        />
      )}
    </>
  )
}
