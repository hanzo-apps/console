'use client'

/**
 * Wallet footer — pinned to the bottom of the sidebar so the org's balance, top-up,
 * and sign-out are one glance / one click away on every page. The signed-in ACCOUNT
 * identity now lives in the sidebar's TOP switcher (SidebarIdentity → account menu),
 * so this footer no longer repeats the name/avatar — it is purely the wallet:
 * - The balance row → the in-console **Billing** module (`/billing`): balance, usage,
 *   invoices — the org's own data, scoped to the active org.
 * - **Top up** → the brand's hosted payment page (`config.payUrl`, e.g. pay.hanzo.ai)
 *   in a NEW TAB. Display + link only: the wallet never hosts a card form or mints
 *   credit — the hosted page owns payment.
 *
 * Sign-out is NOT here. It belongs to the ONE account control at the foot of the
 * rail (`AccountMenu`); this used to be one of four places that offered it.
 *
 * The balance comes from the per-tenant `/billing/*` server proxy, scoped to the
 * caller's OWN org — the exact credit the gateway debits.
 */
import { useRouter } from 'next/navigation'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight, ExternalLink, Wallet } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { useCloudBalance, spendableCents, balanceSplitLabel } from '~/lib/billing/live-balance'

const fmtUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

export function SidebarWallet({ collapsed }: { collapsed: boolean }) {
  const { account } = useSession()
  const router = useRouter()
  const owner = account?.owner ?? ''
  // ONE shared live balance (same value the Wallet/Cost pages show): refetches on
  // mount, on window focus/visibility, on a 30s poll, and after any completion or
  // top-up — so spend/credit changes reflect here without a reload.
  const { balance } = useCloudBalance()
  const cents = spendableCents(balance)
  // The distinct trial + prepaid split ("$5.00 trial + $X.XX credits"), when commerce
  // reports the buckets — else null and we show only the combined total.
  const splitText = balanceSplitLabel(balance)

  if (!owner) return null

  const balanceText = cents === null ? '—' : fmtUsd(cents)
  const openCost = () => router.push('/billing')
  // Top up → the brand's hosted payment page in a new tab (display + link only; the
  // console never hosts a card form or mints credit — pay.<brand> owns payment).
  const openTopUp = () => {
    if (typeof window !== 'undefined') window.open(config.payUrl, '_blank', 'noopener,noreferrer')
  }

  if (collapsed) {
    // One affordance: the wallet. Identity and sign-out are the account control's.
    return (
      <YStack items="center" gap="$2">
        <Button size="$2" chromeless onPress={openTopUp} icon={<Wallet size={18} />} aria-label={`Wallet ${balanceText} — top up`} />
      </YStack>
    )
  }

  return (
    <YStack gap="$2" px="$2.5" py="$2.5" rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
      {/* Balance → Cost (with the trial + prepaid split when reported) */}
      <YStack
        onPress={openCost}
        cursor="pointer"
        hoverStyle={{ opacity: 0.85 }}
        px="$1"
        gap="$0.5"
        aria-label={`Balance ${balanceText}${splitText ? ` (${splitText})` : ''} — open Cost`}
      >
        <XStack items="center" justify="space-between">
          <XStack items="center" gap="$2">
            <Wallet size={15} opacity={0.75} />
            <Text fontSize="$3" fontWeight="700" color="$color12">{balanceText}</Text>
          </XStack>
          <ChevronRight size={14} opacity={0.4} />
        </XStack>
        {splitText ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{splitText}</Text> : null}
      </YStack>

      <Button size="$2" onPress={openTopUp} iconAfter={<ExternalLink size={13} />} aria-label="Top up — opens the payment page in a new tab">Top up</Button>
    </YStack>
  )
}
