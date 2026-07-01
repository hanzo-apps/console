'use client'

/**
 * Always-visible identity + wallet — pinned to the bottom of the sidebar so a
 * customer's account, balance, top-up, and sign-out are one glance / one click
 * away on every page.
 *
 * Identity (avatar + display name) comes from the signed-in IAM account. Three
 * destinations, one way each:
 * - The user row → the **Profile** page (`/profile`): account, security, keys.
 * - The balance row → the in-console **Cost** module (`/cost`): balance, usage,
 *   invoices — the org's own data, scoped to the active org.
 * - **Top up** → the brand billing portal (billing.hanzo.ai) — payment is never
 *   rebuilt here. **Sign out** sits directly beneath it.
 *
 * The balance comes from the per-tenant `/billing/*` server proxy, scoped to the
 * caller's OWN org — the exact credit the gateway debits.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar, Button, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight, LogOut, Wallet } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { WalletApi } from '~/lib/api/wallet'

const fmtUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/** Up-to-two-letter initials from a display name / handle (avatar fallback). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Open the brand billing portal (billing.hanzo.ai) for add-credit / checkout. */
function openTopUp(): void {
  if (typeof window !== 'undefined') {
    window.open(`${config.billingUrl}/topup`, '_blank', 'noopener')
  }
}

/** The account avatar — IAM photo when present, initials circle otherwise. */
function IdentityAvatar({ name, avatar, size }: { name: string; avatar?: string; size: number }) {
  return (
    <Avatar circular size={size}>
      {avatar ? <Avatar.Image accessibilityLabel={name} src={avatar} /> : null}
      <Avatar.Fallback bg="$color5" items="center" justify="center">
        <Text fontSize={size <= 28 ? '$1' : '$2'} fontWeight="800" color="$color12">
          {initials(name)}
        </Text>
      </Avatar.Fallback>
    </Avatar>
  )
}

export function SidebarWallet({ collapsed }: { collapsed: boolean }) {
  const { account, signOut } = useSession()
  const router = useRouter()
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

  const name = account?.displayName || account?.name || 'Account'
  const avatar = typeof account?.avatar === 'string' ? account.avatar : undefined
  const balanceText = cents === null ? '—' : fmtUsd(cents)
  const openProfile = () => router.push('/profile')
  const openCost = () => router.push('/cost')

  if (collapsed) {
    // Three stacked affordances: identity (→ Profile), top-up, sign out.
    return (
      <YStack items="center" gap="$2">
        <YStack onPress={openProfile} cursor="pointer" hoverStyle={{ opacity: 0.85 }} aria-label={`${name} — open Profile`}>
          <IdentityAvatar name={name} avatar={avatar} size={32} />
        </YStack>
        <Button size="$2" chromeless onPress={openTopUp} icon={<Wallet size={18} />} aria-label={`Wallet ${balanceText} — top up`} />
        <Button size="$2" chromeless onPress={() => void signOut()} icon={<LogOut size={18} />} aria-label="Sign out" />
      </YStack>
    )
  }

  return (
    <YStack gap="$2" px="$2.5" py="$2.5" rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
      {/* Identity → Profile */}
      <XStack items="center" gap="$2.5" onPress={openProfile} cursor="pointer" hoverStyle={{ opacity: 0.85 }} aria-label={`${name} — open Profile`}>
        <IdentityAvatar name={name} avatar={avatar} size={36} />
        <YStack flex={1} minW={0}>
          <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>{name}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{account?.email || 'View profile'}</Text>
        </YStack>
        <ChevronRight size={16} opacity={0.5} />
      </XStack>

      {/* Balance → Cost */}
      <XStack
        items="center"
        justify="space-between"
        onPress={openCost}
        cursor="pointer"
        hoverStyle={{ opacity: 0.85 }}
        px="$1"
        aria-label={`Balance ${balanceText} — open Cost`}
      >
        <XStack items="center" gap="$1.5">
          <Wallet size={13} opacity={0.7} />
          <Text fontSize="$2" color="$color11">{balanceText}</Text>
        </XStack>
        <ChevronRight size={14} opacity={0.4} />
      </XStack>

      <Button size="$2" onPress={openTopUp}>Top up</Button>
      <Button size="$2" chromeless icon={<LogOut size={15} />} onPress={() => void signOut()} justify="center">
        Sign out
      </Button>
    </YStack>
  )
}
