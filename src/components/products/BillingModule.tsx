'use client'

/**
 * Billing Center — the ONE unified, GCP-Cloud-Billing-style money surface for the
 * console. A single tabbed product (registry `''` + `:tab` route) that composes
 * every billing surface so there is exactly one place to see and manage spend,
 * whether inside the full console (the Billing section) OR standalone at
 * billing.hanzo.ai (billing-only shell mode — SAME component, filtered nav).
 *
 * Tabs, each a real surface over the per-tenant `/billing` commerce proxy (no
 * fabricated data — every number is real or an honest absent state):
 *   Overview      — balance, month-to-date spend, linear projection, spend trend.
 *   Reports       — cost breakdown by service (model/provider), filterable + charts.
 *   Budgets       — create/list spend budgets (real `/v1/billing/spend-alerts`).
 *   Invoices      — invoice history + download (`/v1/billing/invoices`).
 *   Subscriptions — the org's plans/status/renewal (reuses `SubscriptionsModule`).
 *   Payment       — saved, masked payment methods (reuses `PaymentMethodsModule`).
 *   Credits       — card top-up (Square) with a link to HUSD crypto (`BillingCredits`).
 *
 * Composition over duplication: the last three tabs REUSE the existing modules
 * verbatim (each self-headed), so consolidating the old scattered Cost /
 * Subscriptions / Payment-methods entries into one center forks nothing.
 */
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button, XStack } from '@hanzo/gui'

import { BillingOverview } from './billing/BillingOverview'
import { BillingReports } from './billing/BillingReports'
import { BillingBudgets } from './billing/BillingBudgets'
import { BillingInvoices } from './billing/BillingInvoices'
import { SubscriptionsModule } from './SubscriptionsModule'
import { PaymentMethodsModule } from './PaymentMethodsModule'
import { BillingCredits } from './billing/BillingCredits'

/** The billing-center tabs, in display order. `id` matches the registry sub-page slug. */
const TABS: { id: string; label: string }[] = [
  { id: '', label: 'Overview' },
  { id: 'reports', label: 'Reports' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'payment-methods', label: 'Payment methods' },
  { id: 'credits', label: 'Credits' },
]

const path = (id: string): string => (id ? `/billing/${id}` : '/billing')

export function BillingModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  // Normalize an unknown/base tab (settings/status/…) to the Overview, like the
  // other tabbed modules (GpusModule) — never a dead sub-page.
  const tab = useMemo(() => (TABS.some((t) => t.id === params.tab) ? params.tab ?? '' : ''), [params.tab])

  return (
    <>
      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id || 'overview'}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(path(t.id))}
          >
            {t.label}
          </Button>
        ))}
      </XStack>

      {tab === 'reports' ? (
        <BillingReports params={params} />
      ) : tab === 'budgets' ? (
        <BillingBudgets params={params} />
      ) : tab === 'invoices' ? (
        <BillingInvoices params={params} />
      ) : tab === 'subscriptions' ? (
        <SubscriptionsModule params={params} />
      ) : tab === 'payment-methods' ? (
        <PaymentMethodsModule params={params} />
      ) : tab === 'credits' ? (
        <BillingCredits params={params} />
      ) : (
        <BillingOverview params={params} />
      )}
    </>
  )
}

export default BillingModule
