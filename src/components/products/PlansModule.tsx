'use client'

/**
 * Plans & Pricing — the discovery surface that guides a user from "what can I run"
 * to "what will it cost" and, for a paid tier, into checkout. It reads the published
 * cloud subscription catalog (Developer / Pro / Max / Team / Enterprise) through the
 * per-tenant billing proxy (`PlansApi.plans` -> GET /v1/billing/plans), so a signed-in
 * user actually SEES the tiers — the old /v1/pricing read 401'd on the live ingress and
 * rendered a bare "Not authorized", so nobody could see or subscribe to Pro.
 *
 * It does NOT take money here: subscribing happens in the brand billing portal
 * (`config.billingUrl` — hanzoai/billing over commerce, Square checkout), which every
 * card's CTA opens. One money surface, never reimplemented.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, Check, CreditCard, RefreshCw, Star } from '@hanzogui/lucide-icons-2'
import { useAnalytics } from '@hanzo/event/react'
import { EVENTS } from '@hanzo/event'

import { PlansApi, type Plan } from '~/lib/api'
import { config } from '~/config'

/** Open the brand billing portal (Square checkout) — the ONE money surface; the console
 *  LINKS here, never reimplements it. `#pricing` lands on the portal's checkout section,
 *  matching the portal's own plan-card CTA. */
function openBilling(anchor = ''): void {
  if (typeof window !== 'undefined') window.open(`${config.billingUrl}${anchor}`, '_blank', 'noopener')
}

import { promoActive, effectiveMonthly, promoLabel } from '~/lib/billing/promo'
import { BackendStateCard, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

/** The price headline for a tier: a quote, free, or the whole-dollar monthly price. */
function priceLabel(p: Plan): string {
  if (p.contactSales) return 'Contact sales'
  if (p.priceMonthly === 0) return 'Free'
  return `$${effectiveMonthly(p) ?? p.priceMonthly}`
}

/** The subscribe CTA label for a tier. */
function ctaLabel(p: Plan): string {
  if (p.contactSales) return 'Talk to sales'
  if (p.priceMonthly === 0) return 'Start free'
  return `Upgrade to ${p.name}`
}

function PlanCard({ plan }: { plan: Plan }) {
  const analytics = useAnalytics()
  const highlight = plan.popular
  const free = plan.priceMonthly === 0 && !plan.contactSales
  const showAnnual = !plan.contactSales && plan.priceMonthly > 0 && !!plan.priceAnnual && plan.priceAnnual < plan.priceMonthly
  return (
    <Card
      borderWidth={highlight ? 2 : 1}
      borderColor={highlight ? '$color8' : '$borderColor'}
      p="$4"
      gap="$3"
      width={272}
    >
      <XStack justify="space-between" items="center">
        <Text fontSize="$6" fontWeight="800">
          {plan.name}
        </Text>
        {plan.popular ? (
          <XStack bg="$color5" px="$2" py="$1" rounded="$10" items="center" gap="$1">
            <Star size={11} />
            <Text fontSize="$1" fontWeight="700" color="$color12">
              Popular
            </Text>
          </XStack>
        ) : free ? (
          <XStack bg="$color4" px="$2" py="$1" rounded="$10">
            <Text fontSize="$1" fontWeight="700" color="$color11">
              Free tier
            </Text>
          </XStack>
        ) : null}
      </XStack>

      <XStack items="flex-end" gap="$1.5">
        <Text fontSize="$9" fontWeight="900">
          {priceLabel(plan)}
        </Text>
        {!plan.contactSales && plan.priceMonthly > 0 ? (
          <Text fontSize="$3" color="$color11" mb="$1.5">
            /mo
          </Text>
        ) : null}
        {promoActive(plan) ? (
          <Text fontSize="$3" color="$color9" mb="$1.5" textDecorationLine="line-through">
            ${plan.priceMonthly}
          </Text>
        ) : null}
        {promoActive(plan) ? (
          <Text fontSize="$1" fontWeight="700" color="$green11" mb="$2">
            {promoLabel(plan)}
          </Text>
        ) : null}
        {showAnnual ? (
          <Text fontSize="$2" color="$color10" mb="$1.5">
            · ${plan.priceAnnual}/mo annually
          </Text>
        ) : null}
      </XStack>

      <Text fontSize="$3" color="$color11" minH={48}>
        {plan.description}
      </Text>

      <YStack gap="$1.5">
        {plan.features.map((f) => (
          <XStack key={f} gap="$2" items="center">
            <Check size={14} color="$color10" />
            <Text fontSize="$3" color="$color12">
              {f}
            </Text>
          </XStack>
        ))}
      </YStack>

      <Button
        theme={highlight ? 'light' : undefined}
        iconAfter={<ArrowUpRight size={15} />}
        onPress={() => {
          // Selecting a tier both records the plan choice and enters the brand billing
          // portal (Square checkout) — so it is a plan click AND the start of checkout.
          analytics.capture(EVENTS.PLAN_CLICKED, { plan: plan.name })
          analytics.capture(EVENTS.CHECKOUT_STARTED, { plan: plan.name })
          openBilling('#pricing')
        }}
        mt="$1"
      >
        {ctaLabel(plan)}
      </Button>
    </Card>
  )
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function PlansModule(_props: { params: Record<string, string> }) {
  const analytics = useAnalytics()
  const [state, setState] = useState<Async<Plan[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PlansApi.plans()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // The plans/pricing surface opened — upgrade-intent funnel entry.
  useEffect(() => {
    analytics.capture(EVENTS.PRICING_VIEWED)
  }, [analytics])

  const plans = state.phase === 'ready' ? state.data : []

  return (
    <>
      <PageHeader
        title="Plans & Pricing"
        subtitle={`Pick a plan that fits, then subscribe in ${config.brandName} Billing. Usage is metered; upgrade or downgrade anytime.`}
        actions={
          <XStack gap="$2">
            <Button icon={<RefreshCw size={16} />} onPress={load}>
              Refresh
            </Button>
            <Button theme="light" icon={<CreditCard size={16} />} onPress={() => openBilling()}>
              Open Billing
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/billing/plans" />
      ) : state.phase === 'loading' ? (
        <Text color="$color11">Loading plans…</Text>
      ) : plans.length === 0 ? (
        <Text color="$color11">No plans available right now.</Text>
      ) : (
        <XStack flexWrap="wrap" gap="$3">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </XStack>
      )}

      <Card p="$4" gap="$1.5" borderWidth={1} borderColor="$borderColor" bg="$color2">
        <Text fontSize="$3" color="$color11">
          Managed data products (SQL, Vector, KV, Search, S3, DocDB, Datastore) are billed by usage
          on top of your plan. Provision them from their pages in the catalog; pay and view invoices
          in Billing.
        </Text>
      </Card>
    </>
  )
}
