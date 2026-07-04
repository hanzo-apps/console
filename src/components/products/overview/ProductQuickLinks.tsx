'use client'

/**
 * ProductQuickLinks — the ONE reusable Billing / Usage / Metrics quick-links band
 * rendered at the top of EVERY product's Overview (wired once in the product
 * catch-all, never hand-copied per module — DRY). Each product gets a consistent
 * row of three link-cards, scoped to THAT product:
 *
 *   - Billing → the product's spend (USD), links to Cost Reports pre-filtered to
 *     the product's meter.
 *   - Usage   → the product's requests, links to the product's own Metrics sub-page
 *     (the REAL `/v1/billing/usage` ledger scoped to the product).
 *   - Metrics → the product's success rate, links to the same per-product Metrics
 *     dashboard (usage over time, breakdowns, latency).
 *
 * Every figure is REAL — one product-scoped `UsageApi.overview` read
 * (`/v1/billing/usage` filtered by `metadata.product` via `usageProductFilter`) —
 * or HONEST-EMPTY: a product with no attributed usage shows real zeros / an em
 * dash, never a fabricated number. The links ALWAYS work regardless of the data
 * state, so a load hiccup degrades to "—" with a live link, never an "Access
 * required" wall. Destinations come from the pure `quickLinkTargetsFor` (each a
 * real in-console route, so none can 404). Styling matches the overview fact cards
 * (dark-theme, v5 shorthands).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Text, XStack } from '@hanzo/gui'
import { Activity, ArrowUpRight, BarChart3, CreditCard } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry, ProductIcon } from '~/lib/products/registry'
import { UsageApi } from '~/lib/api/usage'
import { quickLinkTargetsFor, statsFromOverview, usageProductFilter, type QuickLinkStats } from './quick-links'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const count = (n: number): string => n.toLocaleString()

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; stats: QuickLinkStats }
  // A load miss still renders the LINKS with honest "—" figures (never a wall).
  | { phase: 'unavailable' }

/** One quick-link card: a real figure (or honest "—") that navigates to its target. */
function QuickCard({
  icon: Icon,
  label,
  value,
  sub,
  cta,
  to,
}: {
  icon: ProductIcon
  label: string
  value: string
  sub: string
  cta: string
  to: string
}) {
  const router = useRouter()
  return (
    <Card
      flex={1}
      minW={200}
      p="$3.5"
      gap="$2.5"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
      cursor="pointer"
      hoverStyle={{ borderColor: '$color8', bg: '$color2' }}
      pressStyle={{ bg: '$color3' }}
      onPress={() => router.push(to)}
      role="link"
      aria-label={`${label} — ${cta}`}
    >
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2">
          <Icon size={15} color="$color10" />
          <Text fontSize="$2" color="$color10" fontWeight="700" textTransform="uppercase" letterSpacing={0.3}>
            {label}
          </Text>
        </XStack>
        <ArrowUpRight size={14} color="$color9" />
      </XStack>
      <Text fontSize="$7" fontWeight="800" color="$color12" numberOfLines={1}>
        {value}
      </Text>
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {sub}
        </Text>
        <Text fontSize="$1" color="$color11" fontWeight="600" numberOfLines={1}>
          {cta} →
        </Text>
      </XStack>
    </Card>
  )
}

export function ProductQuickLinks({ entry }: { entry: CatalogEntry }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const seq = ++reqRef.current
    setState({ phase: 'loading' })
    const product = usageProductFilter(entry.id)
    UsageApi.overview({ range: '30d', product, activityLimit: 1, topModels: 6 })
      .then((ov) => {
        if (reqRef.current === seq) setState({ phase: 'ready', stats: statsFromOverview(ov) })
      })
      .catch(() => {
        // Honest degrade — the band still renders its live links with "—" figures,
        // never a fabricated number and never an "Access required" error card.
        if (reqRef.current === seq) setState({ phase: 'unavailable' })
      })
  }, [entry.id])

  useEffect(() => {
    load()
  }, [load])

  const targets = quickLinkTargetsFor(entry)
  const ready = state.phase === 'ready' ? state.stats : null
  const loading = state.phase === 'loading'

  // Honest figures: real when loaded, an em dash while loading OR on a load miss.
  const spend = ready ? usd(ready.spendCents) : '—'
  const requests = ready ? count(ready.requests) : '—'
  const success = ready ? (ready.successRate === null ? '—' : `${(ready.successRate * 100).toFixed(1)}%`) : '—'
  const tokensSub = ready ? `${count(ready.tokens)} tokens` : loading ? 'Loading…' : 'Usage this month'

  return (
    <XStack gap="$3" flexWrap="wrap" items="stretch">
      <QuickCard
        icon={CreditCard}
        label="Billing"
        value={spend}
        sub="Spend · last 30 days"
        cta="Cost reports"
        to={targets.billing}
      />
      <QuickCard icon={Activity} label="Usage" value={requests} sub={tokensSub} cta="Usage details" to={targets.usage} />
      <QuickCard
        icon={BarChart3}
        label="Metrics"
        value={success}
        sub="Success rate · last 30 days"
        cta="Full metrics"
        to={targets.metrics}
      />
    </XStack>
  )
}
