'use client'

/**
 * Finance — the signed-in org's per-tenant view of the unified finance ledger
 * (`/v1/finance/*`, hanzoai/finance): balance, metered spend, credits, invoices,
 * payment methods, and the double-entry ledger.
 *
 * The board itself is the SHARED `@hanzo/finance-ui` `FinanceDashboard` — the SAME
 * component finance.hanzo.ai renders — so a spend/usage/credits card looks and behaves
 * identically across both surfaces (that shared reuse is the whole point). This module
 * only supplies console's chrome (`PageHeader`) + console's honest error states
 * (`BackendStateCard`) + the console-wired transport (`financeClient` → the `/v1`
 * bearer proxy). Nothing is reimplemented; nothing is fabricated.
 */
import { YStack } from '@hanzo/gui'
import { FinanceDashboard } from '@hanzo/finance-ui'

import { PageHeader } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend } from '@hanzo/ui/product'
import { financeClient } from '~/lib/api/finance-ledger'

export function FinanceModule(_props: { params: Record<string, string> }) {
  return (
    <YStack gap="$4">
      <PageHeader
        title="Finance"
        subtitle="Your organization’s ledger, spend, credits, invoices, and payment methods."
      />
      <FinanceDashboard
        client={financeClient()}
        theme="dark"
        showTreasury={false}
        renderError={(error, retry) => <BackendStateCard state={classifyBackend(error)} onRetry={retry} />}
      />
    </YStack>
  )
}

