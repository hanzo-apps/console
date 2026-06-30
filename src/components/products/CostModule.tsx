'use client'

/**
 * Cost — the tenant's spend at a glance: cloud-credit balance, metered usage by
 * product/model, and invoice history. Real commerce data through the console's
 * own per-tenant `/billing/*` proxy (server-injected service token, scoped to the
 * caller's org). Read-only — actually paying / managing payment methods stays in
 * the brand billing portal (`config.billingUrl`), which this links to.
 *
 * Three independent sections, each with honest loading / empty / error states
 * (`BackendStateCard`): a 404/501 on `usage` or `invoices` (commerce ships those
 * surfaces incrementally) degrades that one card, never the page, and never shows
 * fabricated spend.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { CreditCard, ExternalLink, RefreshCw } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { BillingApi, type Invoice, type Usage } from '~/lib/api/billing'
import type { CloudBalance } from '~/lib/api/wallet'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const fmtDate = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

function openBillingPortal(): void {
  if (typeof window !== 'undefined') window.open(`${config.billingUrl}/topup`, '_blank', 'noopener')
}

/** A titled section wrapper so each card renders its own honest state. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <YStack gap="$2">
      <Text fontSize="$5" fontWeight="800" color="$color12">
        {title}
      </Text>
      {children}
    </YStack>
  )
}

export function CostModule(_props: { params: Record<string, string> }) {
  const [balance, setBalance] = useState<Async<CloudBalance>>({ phase: 'loading' })
  const [usage, setUsage] = useState<Async<Usage>>({ phase: 'loading' })
  const [invoices, setInvoices] = useState<Async<Invoice[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setBalance({ phase: 'loading' })
    setUsage({ phase: 'loading' })
    setInvoices({ phase: 'loading' })
    BillingApi.balance()
      .then((data) => setBalance({ phase: 'ready', data }))
      .catch((e) => setBalance({ phase: 'error', error: classifyBackend(e) }))
    BillingApi.usage()
      .then((data) => setUsage({ phase: 'ready', data }))
      .catch((e) => setUsage({ phase: 'error', error: classifyBackend(e) }))
    BillingApi.invoices()
      .then((data) => setInvoices({ phase: 'ready', data }))
      .catch((e) => setInvoices({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const usageColumns: Column<Usage['lines'][number]>[] = [
    { key: 'label', header: 'Product / model', render: (l) => <Text fontSize="$3" fontWeight="600" color="$color12">{l.label}</Text> },
    { key: 'units', header: 'Requests', width: 120, render: (l) => <Text fontSize="$3" color="$color11">{l.units ?? '—'}</Text> },
    { key: 'tokens', header: 'Tokens', width: 130, render: (l) => <Text fontSize="$3" color="$color11">{l.tokens != null ? l.tokens.toLocaleString() : '—'}</Text> },
    { key: 'cents', header: 'Cost', width: 110, render: (l) => <Text fontSize="$3" color="$color12">{usd(l.cents)}</Text> },
  ]

  const invoiceColumns: Column<Invoice>[] = [
    { key: 'date', header: 'Date', width: 140, render: (r) => <Text fontSize="$3" color="$color11">{fmtDate(r.date)}</Text> },
    { key: 'id', header: 'Invoice', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{r.id}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (r) => <Text fontSize="$3" color="$color11">{r.status ?? '—'}</Text> },
    { key: 'cents', header: 'Amount', width: 110, render: (r) => <Text fontSize="$3" color="$color12">{usd(r.cents)}</Text> },
    {
      key: 'url',
      header: '',
      width: 90,
      render: (r) =>
        r.url ? (
          <Button size="$2" chromeless icon={<ExternalLink size={13} />} onPress={() => { if (typeof window !== 'undefined') window.open(r.url, '_blank', 'noopener') }}>
            View
          </Button>
        ) : (
          <Text fontSize="$2" color="$color10">—</Text>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Cost"
        subtitle="Balance, usage, and invoices for every product — billed to the same account the gateway debits."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" theme="light" iconAfter={<ExternalLink size={14} />} onPress={openBillingPortal}>
              Add credits
            </Button>
          </XStack>
        }
      />

      {/* ── Balance + period total ────────────────────────────────────────── */}
      <XStack flexWrap="wrap" gap="$3">
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" width={300}>
          <XStack items="center" gap="$2">
            <CreditCard size={16} />
            <Text fontSize="$5" fontWeight="700">Cloud credit</Text>
          </XStack>
          {balance.phase === 'ready' ? (
            <YStack gap="$1">
              <Text fontSize="$9" fontWeight="900">{usd(balance.data.available)}</Text>
              <Text fontSize="$2" color="$color11">
                available · {usd(balance.data.balance)} total · {usd(balance.data.holds)} on hold
              </Text>
            </YStack>
          ) : balance.phase === 'error' ? (
            <BackendStateCard state={balance.error} hint="endpoint · GET /v1/billing/balance" />
          ) : (
            <Text fontSize="$3" color="$color11">Loading…</Text>
          )}
        </Card>

        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" width={300}>
          <XStack items="center" gap="$2">
            <Text fontSize="$5" fontWeight="700">Spend this period</Text>
          </XStack>
          {usage.phase === 'ready' ? (
            <YStack gap="$1">
              <Text fontSize="$9" fontWeight="900">{usd(usage.data.totalCents)}</Text>
              <Text fontSize="$2" color="$color11">
                {usage.data.start ? `${fmtDate(usage.data.start)} – ${fmtDate(usage.data.end)}` : 'current billing period'}
              </Text>
            </YStack>
          ) : usage.phase === 'error' ? (
            <Text fontSize="$3" color="$color11">Usage total appears once metering is reported.</Text>
          ) : (
            <Text fontSize="$3" color="$color11">Loading…</Text>
          )}
        </Card>
      </XStack>

      {/* ── Usage breakdown ───────────────────────────────────────────────── */}
      <Section title="Usage by product">
        {usage.phase === 'error' ? (
          <BackendStateCard state={usage.error} onRetry={load} hint="endpoint · GET /v1/billing/usage" />
        ) : (
          <DataTable
            columns={usageColumns}
            rows={usage.phase === 'ready' ? usage.data.lines : []}
            loading={usage.phase === 'loading'}
            rowKey={(l) => l.label}
            empty="No metered usage in this period yet."
          />
        )}
      </Section>

      {/* ── Invoices ──────────────────────────────────────────────────────── */}
      <Section title="Invoices">
        {invoices.phase === 'error' ? (
          <BackendStateCard state={invoices.error} onRetry={load} hint="endpoint · GET /v1/billing/invoices" />
        ) : (
          <DataTable
            columns={invoiceColumns}
            rows={invoices.phase === 'ready' ? invoices.data : []}
            loading={invoices.phase === 'loading'}
            rowKey={(r) => r.id}
            empty="No invoices yet. Invoices appear here once your first billing period closes."
          />
        )}
      </Section>
    </>
  )
}
