'use client'

/**
 * Home summary strip — the at-a-glance account header on the console home, the
 * way DigitalOcean/Vercel open with balance + spend before the resource grid.
 *
 * Real per-tenant data over the same `/billing/*` proxy the Cost page and sidebar
 * wallet use (server-injected token, scoped to the caller's org). It is purely
 * additive and fail-quiet: if billing isn't configured/routed on a deployment the
 * strip simply doesn't render (the catalog below is the home's substance) — it
 * never shows a fabricated balance and never blocks the page.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, CreditCard, TrendingUp } from '@hanzogui/lucide-icons-2'

import { useSession } from '~/lib/auth/session'
import { BillingApi } from '~/lib/api/billing'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

type Stats = { availableCents: number | null; spendCents: number | null }

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor" flex={1} minW={200}>
      <XStack items="center" gap="$1.5">
        {icon}
        <Text fontSize="$2" color="$color10">
          {label}
        </Text>
      </XStack>
      <Text fontSize="$8" fontWeight="900" color="$color12">
        {value}
      </Text>
      {hint ? (
        <Text fontSize="$2" color="$color10">
          {hint}
        </Text>
      ) : null}
    </Card>
  )
}

export function HomeSummary() {
  const router = useRouter()
  const { account } = useSession()
  const signedIn = Boolean(account?.owner)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    void (async () => {
      const [balance, usage] = await Promise.allSettled([BillingApi.balance(), BillingApi.usage()])
      if (!alive) return
      const availableCents = balance.status === 'fulfilled' ? balance.value.available : null
      const spendCents = usage.status === 'fulfilled' ? usage.value.totalCents : null
      // Only render the strip if at least one real number came back — otherwise it
      // stays hidden (no fabricated stats, no empty scaffold).
      if (availableCents === null && spendCents === null) return
      setStats({ availableCents, spendCents })
    })()
    return () => {
      alive = false
    }
  }, [signedIn])

  if (!signedIn || !stats) return null

  return (
    <XStack flexWrap="wrap" gap="$3" items="stretch">
      <Stat
        icon={<CreditCard size={14} opacity={0.7} />}
        label="Cloud credit"
        value={stats.availableCents != null ? usd(stats.availableCents) : '—'}
        hint="available to spend"
      />
      <Stat
        icon={<TrendingUp size={14} opacity={0.7} />}
        label="Spend this period"
        value={stats.spendCents != null ? usd(stats.spendCents) : '—'}
        hint="across every product"
      />
      <Card
        p="$3.5"
        gap="$2"
        borderWidth={1}
        borderColor="$borderColor"
        bg="$color2"
        flex={1}
        minW={220}
        justify="center"
      >
        <Text fontSize="$3" color="$color11">
          Manage balance, usage, and invoices.
        </Text>
        <XStack gap="$2">
          <Button size="$2" iconAfter={<ArrowRight size={14} />} onPress={() => router.push('/billing')}>
            View cost
          </Button>
          <Button size="$2" chromeless onPress={() => router.push('/billing/credits')}>
            Add credits
          </Button>
        </XStack>
      </Card>
    </XStack>
  )
}
