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
 *   Accounts      — which account pays and in what order: attach an account to the
 *                   org or to one project, and reorder the chain commerce resolves.
 *   Budgets       — create/list spend budgets (real `/v1/billing/alerts`).
 *   Invoices      — invoice history + download (`/v1/billing/invoices`).
 *   Subscriptions — the org's plans/status/renewal (reuses `SubscriptionsModule`).
 *   Payment       — saved, masked payment methods (reuses `PaymentMethodsModule`).
 *   Credits       — card top-up (Square) with a link to HUSD crypto (`BillingCredits`).
 *
 * Composition over duplication: the last three tabs REUSE the existing modules
 * verbatim (each self-headed), so consolidating the old scattered Cost /
 * Subscriptions / Payment-methods entries into one center forks nothing.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'

import { BillingOverview } from './billing/BillingOverview'
import { BillingReports } from './billing/BillingReports'
import { BillingAccounts } from './billing/BillingAccounts'
import { BillingBudgets } from './billing/BillingBudgets'
import { BillingInvoices } from './billing/BillingInvoices'
import { SubscriptionsModule } from './SubscriptionsModule'
import { PaymentMethodsModule } from './PaymentMethodsModule'
import { BillingCredits } from './billing/BillingCredits'

export function BillingModule({ params }: { params: Record<string, string> }) {
  // Normalize an unknown/base tab (settings/status/…) to the Overview, like the
  // other tabbed modules (GpusModule) — never a dead sub-page.
  const tab = productSubpageSlug('billing', params.tab)

  return (
    <>
      <SubNav id="billing" />

      {tab === 'reports' ? (
        <BillingReports params={params} />
      ) : tab === 'accounts' ? (
        <BillingAccounts params={params} />
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

