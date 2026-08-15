'use client'

/**
 * Step 4 — Free trial credits. Model: add a card ON FILE (no upfront charge) to
 * unlock trial credits. The card is entered ONLY in the billing provider's own
 * hosted element (Square Web Payments iframe, `*.squarecdn.com`) and tokenized in the
 * browser — the console never sees a PAN. REAL: `BillingApi.paymentConfig` mounts the
 * element (`useSquareCard`), `createPaymentMethod({token})` vaults the card (the
 * commerce handler grants/extends the trial credit as a side-effect, $1 verify-then-
 * void, no charge), and `balance()` shows the granted balance. Skippable — credits
 * can be added later.
 */
import { useEffect, useRef, useState } from 'react'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { CreditCard, Gift, Lock } from '@hanzogui/lucide-icons-2'

import { BillingApi, type PaymentConfig } from '~/lib/api/billing'
import type { CloudBalance } from '~/lib/api/wallet'
import { useSquareCard } from '~/lib/billing/use-square-card'
import { trialCents, spendableCents, balanceSplitLabel, invalidateBalance } from '~/lib/billing/live-balance'
import { ApiError } from '~/lib/api/client'
import { useToast } from '~/components/ui/Toast'
import { StepShell, StepActions } from '~/components/onboarding/parts'
import type { StepProps } from '~/components/onboarding/types'
import { PrimaryButton } from '@hanzo/ui/product'
import { usd } from '~/lib/money'


type Phase = 'loading' | 'ready' | 'unconfigured' | 'error'

/** Trial credits are already unlocked when a card is on file or credits are granted. */
function unlocked(balance: CloudBalance | null, hasCard: boolean): boolean {
  return hasCard || (trialCents(balance) ?? 0) > 0 || (spendableCents(balance) ?? 0) > 0
}

export function CreditsStep({ next, skip, back, isFirst }: StepProps) {
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>('loading')
  const [cfg, setCfg] = useState<PaymentConfig | null>(null)
  const [balance, setBalance] = useState<CloudBalance | null>(null)
  const [hasCard, setHasCard] = useState(false)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const card = useSquareCard(cfg)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void (async () => {
      const [config, bal, methods] = await Promise.all([
        BillingApi.paymentConfig().catch(() => null),
        BillingApi.balance().catch(() => null),
        BillingApi.paymentMethods().catch(() => []),
      ])
      if (!mounted.current) return
      setBalance(bal)
      setHasCard(methods.length > 0)
      const configured = !!config?.applicationId && !!config?.locationId
      setCfg(configured ? config : null)
      setPhase(configured ? 'ready' : 'unconfigured')
    })()
    return () => {
      mounted.current = false
    }
  }, [])

  const addCard = async () => {
    setAdding(true)
    setErr(null)
    try {
      const token = await card.tokenize()
      await BillingApi.createPaymentMethod({ type: 'card', token })
      // The trial credit is granted SERVER-SIDE as a side-effect of vaulting the card.
      // The browser never mints its own credit — the only credit mint is the
      // mint-gated POST /v1/billing/credit, which a tenant session cannot call.
      const bal = await BillingApi.balance().catch(() => balance)
      if (!mounted.current) return
      setBalance(bal)
      setHasCard(true)
      invalidateBalance()
      const spend = spendableCents(bal)
      toast.success('Trial credits granted', spend ? `Balance: ${usd(spend)}` : undefined)
    } catch (e) {
      setErr(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'The card was not added and nothing was charged. Check the number and expiry and try again, or skip this step and add a card later in Billing.',
      )
    } finally {
      if (mounted.current) setAdding(false)
    }
  }

  const isUnlocked = unlocked(balance, hasCard)
  const split = balanceSplitLabel(balance)

  return (
    <StepShell
      title="Free trial credits"
      subtitle="Add a card and your trial credits are granted straight away. Nothing is charged today — the card is there so your account keeps working once the trial runs out."
      actions={
        <StepActions
          onBack={isFirst ? undefined : back}
          onSkip={phase === 'ready' && !isUnlocked ? skip : undefined}
          skipLabel="Skip for now"
          onContinue={next}
          continueLabel="Continue"
          continueDisabled={phase === 'ready' && !isUnlocked}
          busy={adding}
        />
      }
    >
      {phase === 'loading' ? (
        <Card p="$5" items="center" borderWidth={1} borderColor="$borderColor">
          <Spinner size="large" color="$color11" />
        </Card>
      ) : isUnlocked ? (
        <Card p="$4" gap="$2.5" borderWidth={1} borderColor="$green7" bg="$green2">
          <XStack gap="$2" items="center">
            <Gift size={20} color="var(--green11)" />
            <Text fontSize="$5" fontWeight="700" color="$green11">
              Trial credits granted
            </Text>
          </XStack>
          <Text fontSize="$6" fontWeight="800" color="$color12">
            {usd(spendableCents(balance) ?? 0)}
          </Text>
          {split ? (
            <Text fontSize="$2" color="$color11">
              {split}
            </Text>
          ) : null}
          <Text fontSize="$2" color="$color10">
            {hasCard ? 'Card on file — you can manage it in Billing.' : 'You can add a card anytime in Billing.'}
          </Text>
        </Card>
      ) : phase === 'unconfigured' ? (
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <XStack gap="$2" items="center">
            <CreditCard size={18} color="var(--color10)" />
            <Text fontSize="$4" fontWeight="700" color="$color12">
              Payments aren't set up for this organization
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            You can start now without one. Add a card later from Billing and the trial credits are granted then.
          </Text>
        </Card>
      ) : (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack gap="$3" items="center">
            <YStack width={40} height={40} rounded="$4" items="center" justify="center" bg="$color3">
              <CreditCard size={20} />
            </YStack>
            <YStack flex={1} minW={0} gap="$0.5">
              <Text fontSize="$5" fontWeight="700" color="$color12">
                Add a payment card
              </Text>
              <Text fontSize="$2" color="$color11">
                Your card details go straight into the payment provider's own form. The console never sees the number and never stores it.
              </Text>
            </YStack>
          </XStack>

          {/* Square Web Payments mounts its own PCI-scoped iframe into this container. */}
          <YStack
            borderWidth={1}
            borderColor="$borderColor"
            rounded="$4"
            bg="$color2"
            p="$3"
            minH={64}
            justify="center"
          >
            <div ref={card.containerRef} />
            {card.phase === 'mounting' ? (
              <XStack gap="$2" items="center">
                <Spinner size="small" color="$color11" />
                <Text fontSize="$2" color="$color10">
                  Loading secure card form…
                </Text>
              </XStack>
            ) : null}
            {card.phase === 'error' ? (
              <Text fontSize="$2" color="$red10">
                {card.error}
              </Text>
            ) : null}
          </YStack>

          {err ? (
            <Text fontSize="$2" color="$red10">
              {err}
            </Text>
          ) : null}

          <XStack gap="$2" items="center">
            <Lock size={13} color="var(--color10)" />
            <Text fontSize="$1" color="$color10">
              No charge today. Adding the card is what grants the trial credits.
            </Text>
          </XStack>

          <XStack>
            <PrimaryButton
              size="$4"
              disabled={adding || !card.ready}
              icon={adding ? <Spinner size="small" color="$color1" /> : <Gift size={16} />}
              onPress={() => void addCard()}
            >
              {adding ? 'Adding…' : 'Add card & get credits'}
            </PrimaryButton>
          </XStack>
        </Card>
      )}
    </StepShell>
  )
}
