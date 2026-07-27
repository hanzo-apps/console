'use client'

/**
 * AI Accounts — the unified usage + account-connect product (registry `''` + `:tab`).
 * Three tabs, DECLARED in the registry (`subpages`) and rendered by the ONE
 * level-2 nav — the sidebar's drill-down, or `SubNav` where the sidebar is a drawer:
 *   Overview — unified usage across every connected provider + the Hanzo lane.
 *   Routing  — smart routing (`model: "auto"`) explainer + enable/disable + curl.
 *   Accounts — connect/link provider accounts (paste an API key / OAuth token / cookie).
 * The subpage slugs `routing`/`accounts` match the registry entries, so
 * `/ai-accounts/routing` and `/ai-accounts/accounts` land on those tabs directly.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'

import { AIAccountsOverview } from './ai-accounts/OverviewTab'
import { AIAccountsRouting } from './ai-accounts/RoutingTab'
import { AIAccountsAccounts } from './ai-accounts/AccountsTab'
import { AIAccountsMachines } from './ai-accounts/MachinesTab'

export function AIAccountsModule({ params }: { params: Record<string, string> }) {
  const tab = productSubpageSlug('ai-accounts', params.tab)

  return (
    <>
      <SubNav id="ai-accounts" />

      {tab === 'accounts' ? (
        <AIAccountsAccounts params={params} />
      ) : tab === 'machines' ? (
        <AIAccountsMachines params={params} />
      ) : tab === 'routing' ? (
        <AIAccountsRouting params={params} />
      ) : (
        <AIAccountsOverview params={params} />
      )}
    </>
  )
}

