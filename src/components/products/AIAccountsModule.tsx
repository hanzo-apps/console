'use client'

/**
 * AI Accounts — the unified usage + account-connect product (registry `''` + `:tab`).
 * Three tabs, mirroring the BillingModule idiom (a tab bar over `router.push`):
 *   Overview — unified usage across every connected provider + the Hanzo lane.
 *   Routing  — smart routing (`model: "auto"`) explainer + enable/disable + curl.
 *   Accounts — connect/link provider accounts (paste an API key / OAuth token / cookie).
 * The subpage slugs `routing`/`accounts` match the registry entries, so
 * `/ai-accounts/routing` and `/ai-accounts/accounts` land on those tabs directly.
 */
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button, XStack } from '@hanzo/gui'

import { AIAccountsOverview } from './ai-accounts/OverviewTab'
import { AIAccountsRouting } from './ai-accounts/RoutingTab'
import { AIAccountsAccounts } from './ai-accounts/AccountsTab'

const TABS: { id: string; label: string }[] = [
  { id: '', label: 'Overview' },
  { id: 'routing', label: 'Routing' },
  { id: 'accounts', label: 'Accounts' },
]

const path = (id: string): string => (id ? `/ai-accounts/${id}` : '/ai-accounts')

export function AIAccountsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
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

      {tab === 'accounts' ? (
        <AIAccountsAccounts params={params} />
      ) : tab === 'routing' ? (
        <AIAccountsRouting params={params} />
      ) : (
        <AIAccountsOverview params={params} />
      )}
    </>
  )
}

export default AIAccountsModule
