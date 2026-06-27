'use client'

/**
 * Plans & Pricing — the discovery surface that guides a user from "what can I
 * run" to "what will it cost", on the live rate card (GET /v1/pricing). It does
 * NOT take money: paying happens at `config.billingUrl` (hanzoai/billing over the
 * commerce backend), which every card links to. One money surface, never
 * reimplemented here — this is the GCP-style "products & pricing" front door.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Star, CreditCard, RefreshCw, ArrowUpRight } from '@hanzogui/lucide-icons-2'

import { ApiError, PlansApi, type CloudPlan, type BlockStoragePricing } from '~/lib/api'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'

const money = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(n < 1 ? 4 : 2)}`)

/** The feature bullets for a plan — prefer the published list, else derive from specs. */
function planFeatures(p: CloudPlan): string[] {
  if (p.features?.length) return p.features
  const out = [
    `${p.vcpus} ${p.cpuType === 'dedicated' ? 'dedicated ' : ''}vCPU`,
    `${p.memoryGB} GB RAM`,
    `${p.diskGB} GB SSD`,
  ]
  if (p.transferTB) out.push(`${p.transferTB} TB transfer`)
  if (p.maxVMs) out.push(`Up to ${p.maxVMs} VM${p.maxVMs > 1 ? 's' : ''}`)
  return out
}

function openBilling() {
  if (typeof window !== 'undefined') window.open(config.billingUrl, '_blank', 'noopener')
}

function PlanCard({ plan }: { plan: CloudPlan }) {
  const highlight = plan.popular
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
        ) : plan.freeTier ? (
          <XStack bg="$color4" px="$2" py="$1" rounded="$10">
            <Text fontSize="$1" fontWeight="700" color="$color11">
              Free tier
            </Text>
          </XStack>
        ) : null}
      </XStack>

      <XStack items="flex-end" gap="$1.5">
        <Text fontSize="$9" fontWeight="900">
          {money(plan.priceMonthly)}
        </Text>
        <Text fontSize="$3" color="$color11" mb="$1.5">
          /mo
        </Text>
        {plan.priceHourly ? (
          <Text fontSize="$2" color="$color10" mb="$1.5">
            · {money(plan.priceHourly)}/hr
          </Text>
        ) : null}
      </XStack>

      <Text fontSize="$3" color="$color11" minH={48}>
        {plan.description}
      </Text>

      <YStack gap="$1.5">
        {planFeatures(plan).map((f) => (
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
        onPress={openBilling}
        mt="$1"
      >
        {plan.freeTier ? 'Start free' : `Choose ${plan.name}`}
      </Button>
    </Card>
  )
}

export function PlansModule(_props: { params: Record<string, string> }) {
  const [plans, setPlans] = useState<CloudPlan[]>([])
  const [blockStorage, setBlockStorage] = useState<BlockStoragePricing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await PlansApi.pricing()
      setPlans(data?.cloud?.plans ?? [])
      setBlockStorage(data?.cloud?.blockStorage ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load pricing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader
        title="Plans & Pricing"
        subtitle={`Pick a plan that fits, then manage billing in ${config.brandName} Billing. Usage is metered; upgrade or downgrade anytime.`}
        actions={
          <XStack gap="$2">
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
            <Button theme="light" icon={<CreditCard size={16} />} onPress={openBilling}>
              Open Billing
            </Button>
          </XStack>
        }
      />

      {error ? <Text color="$color12">{error}</Text> : null}
      {loading && !plans.length ? <Text color="$color11">Loading pricing…</Text> : null}

      <XStack flexWrap="wrap" gap="$3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
      </XStack>

      {blockStorage ? (
        <Card p="$4" gap="$1.5" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$5" fontWeight="700">
            Block storage
          </Text>
          <Text fontSize="$3" color="$color11">
            Add persistent SSD volumes to any plan at {money(blockStorage.pricePerGBMonthly)}/GB per
            month ({blockStorage.minSizeGB}–{blockStorage.maxSizeGB.toLocaleString()} GB).
          </Text>
        </Card>
      ) : null}

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
