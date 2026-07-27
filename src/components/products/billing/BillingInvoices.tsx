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
import { billingProxyV1Url } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/**
 * The same-origin proxy URL for an invoice's PDF (`/v1/billing/invoices/:id/pdf`).
 * Built from the invoice `id` the list already returns — NOT a server `url` field —
 * so the download rides the tenant-scoped proxy (session-auth + server-injected
 * service token + `X-Org-Id`), and a user can only ever pull their OWN org's invoice.
 * Opening it in a new tab sends the first-party session cookie (same-origin GET), so
 * the proxy authenticates the caller; commerce 404s a foreign id (defense in depth).
 */
const invoicePdfUrl = (id: string): string => billingProxyV1Url(`invoices/${encodeURIComponent(id)}/pdf`)

function openInvoicePdf(id: string): void {
  if (typeof window !== 'undefined') window.open(invoicePdfUrl(id), '_blank', 'noopener')
}
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
      key: 'pdf',
      header: '',
      width: 120,
      render: (r) => (
        <Button
          size="$2"
          chromeless
          icon={<Download size={14} />}
          onPress={() => openInvoicePdf(r.id)}
          aria-label={`Download invoice ${r.id}`}
        >
          Download
        </Button>
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
