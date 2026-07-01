'use client'

/**
 * Payment Methods — the org's saved payment methods, read from real commerce
 * through the console's own per-tenant `/billing/*` proxy (server-injected service
 * token, scoped to the caller's org — the browser can't widen scope).
 *
 * Read-only + masked by construction: commerce returns ONLY a non-sensitive
 * descriptor (brand + last4 + expiry), which is all this renders — never a PAN,
 * CVV, or gateway token, none of which are ever present in the payload. Adding or
 * removing a method happens in the brand billing portal (`config.billingUrl`),
 * which the header links to. Honest loading / empty / error states via
 * `BackendStateCard`; a missing descriptor degrades to "—", never fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, Plus, RefreshCw } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { BillingApi, type PaymentMethod } from '~/lib/api/billing'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

/** Capitalized brand (visa → Visa), or the generic type, or "Card". */
const label = (m: PaymentMethod): string => {
  const b = m.brand?.trim()
  if (b) return b.charAt(0).toUpperCase() + b.slice(1)
  if (m.type) return m.type.charAt(0).toUpperCase() + m.type.slice(1)
  return 'Card'
}

/** •••• 4242 — the masked descriptor, or "—" when commerce reports no last4. */
const masked = (m: PaymentMethod): string => (m.last4 ? `•••• ${m.last4}` : '—')

/** MM / YYYY expiry, or "—" when not a card / not reported. */
const expiry = (m: PaymentMethod): string => {
  if (m.expMonth == null || m.expYear == null) return '—'
  const mm = String(m.expMonth).padStart(2, '0')
  return `${mm} / ${m.expYear}`
}

function openBillingPortal(): void {
  // The brand billing portal root (billing.<brand>). Kept at the ROOT — not a
  // deep `/payment-methods` path — so it resolves both today (the standalone
  // portal) and after billing.<brand> is served by this console in billing-only
  // mode (where the root redirects to the Billing Center), never a dead link.
  if (typeof window !== 'undefined') window.open(config.billingUrl, '_blank', 'noopener')
}

export function PaymentMethodsModule(_props: { params: Record<string, string> }) {
  const [methods, setMethods] = useState<Async<PaymentMethod[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setMethods({ phase: 'loading' })
    BillingApi.paymentMethods()
      .then((data) => setMethods({ phase: 'ready', data }))
      .catch((e) => setMethods({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<PaymentMethod>[] = [
    {
      key: 'brand',
      header: 'Method',
      render: (m) => (
        <XStack items="center" gap="$2">
          <Text fontSize="$3" fontWeight="600" color="$color12">
            {label(m)}
          </Text>
          {m.isDefault ? (
            <YStack px="$2" py={1} rounded="$10" bg="$color5">
              <Text fontSize="$1" fontWeight="800" color="$color12" letterSpacing={0.4}>
                DEFAULT
              </Text>
            </YStack>
          ) : null}
        </XStack>
      ),
    },
    {
      key: 'last4',
      header: 'Number',
      width: 140,
      render: (m) => (
        <Text fontSize="$3" color="$color11" style={{ fontFamily: 'monospace' }}>
          {masked(m)}
        </Text>
      ),
    },
    {
      key: 'expiry',
      header: 'Expires',
      width: 120,
      render: (m) => <Text fontSize="$3" color="$color11">{expiry(m)}</Text>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Payment Methods"
        subtitle="Saved payment methods for your organization. Add or remove a method in the billing portal."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" theme="light" icon={<Plus size={14} />} iconAfter={<ExternalLink size={13} />} onPress={openBillingPortal}>
              Add method
            </Button>
          </XStack>
        }
      />

      {methods.phase === 'error' ? (
        <BackendStateCard state={methods.error} onRetry={load} hint="endpoint · GET /v1/billing/payment-methods" />
      ) : (
        <DataTable
          columns={columns}
          rows={methods.phase === 'ready' ? methods.data : []}
          loading={methods.phase === 'loading'}
          rowKey={(m) => m.id}
          empty="No payment methods on file. Add one in the billing portal."
        />
      )}
    </>
  )
}

export default PaymentMethodsModule
