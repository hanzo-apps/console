'use client'

/**
 * Always-visible wallet — pinned bottom-left of the sidebar so a customer's
 * balance + top-up are one glance / one click away on every page.
 *
 * Balance comes from the per-tenant `/billing/*` server proxy (the same one the
 * Wallet page uses) — scoped to the caller's OWN org, server-resolved, so it
 * shows the exact credit the gateway debits. Top-up never rebuilds payment: it
 * deep-links to the brand billing portal (billing.hanzo.ai → pay.hanzo.ai Square/
 * crypto checkout), per "billing IS commerce, link to it".
 */
import { useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Wallet } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { WalletApi } from '~/lib/api/wallet'

const fmtUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/** Open the brand billing portal (billing.hanzo.ai) for add-credit / checkout. */
function openTopUp(): void {
  if (typeof window !== 'undefined') {
    window.open(`${config.billingUrl}/topup`, '_blank', 'noopener')
  }
}

export function SidebarWallet({ collapsed }: { collapsed: boolean }) {
  const { account } = useSession()
  const owner = account?.owner ?? ''
  const [cents, setCents] = useState<number | null>(null)

  useEffect(() => {
    if (!owner) return
    let alive = true
    const load = async () => {
      try {
        const b = await WalletApi.cloudBalance(owner)
        if (alive) setCents(typeof b.available === 'number' ? b.available : b.balance)
      } catch {
        if (alive) setCents(null)
      }
    }
    void load()
    // Refresh periodically so spend (chat/playground/usage) reflects without a reload.
    const t = setInterval(() => void load(), 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [owner])

  if (!owner) return null

  const balanceText = cents === null ? '—' : fmtUsd(cents)

  if (collapsed) {
    return (
      <Button
        size="$2"
        chromeless
        onPress={openTopUp}
        icon={<Wallet size={16} />}
        aria-label={`Wallet ${balanceText} — top up`}
      />
    )
  }

  return (
    <YStack
      gap="$2"
      px="$2.5"
      py="$2.5"
      rounded="$3"
      bg="$color2"
      borderWidth={1}
      borderColor="$borderColor"
    >
      <XStack items="center" justify="space-between">
        <XStack items="center" gap="$1.5">
          <Wallet size={14} opacity={0.7} />
          <Text fontSize="$1" color="$color10">
            Balance
          </Text>
        </XStack>
        <Text fontSize="$4" fontWeight="700" color="$color12">
          {balanceText}
        </Text>
      </XStack>
      <Button size="$2" onPress={openTopUp}>
        Top up
      </Button>
    </YStack>
  )
}
