'use client'

/**
 * Add credits — the IN-CONSOLE card top-up. A cold customer clicks "Add credits",
 * picks an amount, enters a card in Square's own iframe, and their org's CANONICAL
 * cloud-credit balance (the one the gateway gates AI usage on) goes up. No external
 * portal, no crypto-only dead-end.
 *
 * Money path (one canonical ledger):
 *   card → Square Web Payments SDK tokenizes IN THE BROWSER → opaque nonce
 *   → POST /v1/billing/topup/token (same-origin proxy → commerce, service token,
 *     subject pinned server-side) → commerce charges the org's Square account and
 *     credits transaction.Deposit(subject, "iam-user") → the exact key GetBalance
 *     reads and the gateway debits. invalidateBalance() then refreshes every surface.
 *
 * PCI: card data is entered ONLY into Square's cross-origin iframe and tokenized by
 * Square; the console/servers/logs never see a PAN — SAQ-A scope. We hold only the
 * single-use nonce, which also makes the charge idempotent (a retry replays).
 *
 * Honest states throughout: config-unavailable, decline, in-flight (button locked
 * to prevent a double-charge), success. Crypto (HUSD) stays a secondary option.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { CreditCard, ShieldCheck, Check, ArrowRight, Coins, FlaskConical } from '@hanzogui/lucide-icons-2'

import { BillingApi, type PaymentConfig } from '~/lib/api/billing'
import { isLiveSquareEnv, dollarsToCents, validateTopupCents, PRESET_TOPUP_USD } from '~/lib/billing/square'
import { useSquareCard } from '~/lib/billing/use-square-card'
import { useCloudBalance, spendableCents, invalidateBalance, balanceSplitLabel } from '~/lib/billing/live-balance'
import { BackendStateCard, PageHeader, PrimaryButton, classifyBackend, type BackendState } from '@hanzo/ui/product'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

type ConfigState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; cfg: PaymentConfig }

type Submit =
  | { state: 'idle' }
  | { state: 'submitting' }
  | { state: 'done'; addedCents: number; balanceCents: number }
  | { state: 'error'; message: string }

export function BillingCredits(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const { phase: balPhase, balance: bal } = useCloudBalance()

  const [cfg, setCfg] = useState<ConfigState>({ phase: 'loading' })
  const [amount, setAmount] = useState<string>('25')
  const [submit, setSubmit] = useState<Submit>({ state: 'idle' })

  const cents = dollarsToCents(amount)
  const amountError = cents === null ? null : validateTopupCents(cents)

  // 1) Fetch the tenant's PUBLIC Square config.
  useEffect(() => {
    let alive = true
    BillingApi.paymentConfig()
      .then((c) => alive && setCfg({ phase: 'ready', cfg: c }))
      .catch((e) => alive && setCfg({ phase: 'error', error: classifyBackend(e) }))
    return () => {
      alive = false
    }
  }, [])

  // 2) Once config is ready AND the org has a Square application, the shared card
  //    hook loads the SDK and mounts the PCI-scoped iframe into `card.containerRef`
  //    (the SAME capability the Add-payment-method surface uses).
  const ready = cfg.phase === 'ready' ? cfg.cfg : null
  const configured = !!ready && !!ready.applicationId && !!ready.locationId
  const card = useSquareCard(configured ? ready : null)
  const cardPhase = card.phase

  const pay = useCallback(async () => {
    if (!card.ready || cents === null || amountError || submit.state === 'submitting') return
    setSubmit({ state: 'submitting' })
    try {
      // Tokenize IN Square's iframe → an opaque single-use nonce (never a PAN).
      const token = await card.tokenize()
      // Charge the nonce → credit the canonical balance. The nonce is single-use,
      // so a retry with it replays rather than double-charging.
      const res = await BillingApi.topupWithCard({ sourceId: token, amountCents: cents })
      invalidateBalance() // refresh the shared balance on every surface
      setSubmit({ state: 'done', addedCents: cents, balanceCents: res.balanceCents })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The charge could not be completed.'
      setSubmit({ state: 'error', message })
    }
  }, [card, cents, amountError, submit.state])

  const reset = useCallback(() => {
    setSubmit({ state: 'idle' })
  }, [])

  const canPay = card.ready && cents !== null && !amountError && submit.state !== 'submitting'

  return (
    <>
      <PageHeader
        title="Add credits"
        subtitle="Top up your organization's cloud credit with a card. Credit is added to the same balance the gateway debits for every AI request — instantly."
      />

      {/* Current balance */}
      <Card p="$4" gap="$1" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <CreditCard size={16} />
          <Text fontSize="$4" fontWeight="700" color="$color12">
            Current balance
          </Text>
        </XStack>
        <Text fontSize="$8" fontWeight="900" color="$color12">
          {balPhase === 'ready' && bal ? usd(spendableCents(bal) ?? bal.available) : '—'}
        </Text>
        {/* Distinct trial (non-cash) + prepaid (real money) split, when commerce reports it. */}
        {balPhase === 'ready' && bal && balanceSplitLabel(bal) ? (
          <Text fontSize="$3" color="$color11">{balanceSplitLabel(bal)}</Text>
        ) : null}
      </Card>

      {cfg.phase === 'loading' ? (
        <Card p="$4" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$3" color="$color11">
            Loading card top-up…
          </Text>
        </Card>
      ) : cfg.phase === 'error' ? (
        <BackendStateCard state={cfg.error} hint="endpoint · GET /v1/billing/settings" />
      ) : !configured ? (
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="700" color="$color12">
            No card processor is configured for this organization
          </Text>
          <Text fontSize="$3" color="$color11">
            Card top-up needs a payment processor connected to your organization. You can top up with
            crypto below, or contact support to enable card payments.
          </Text>
        </Card>
      ) : submit.state === 'done' ? (
        <Card p="$5" gap="$3" borderWidth={1} borderColor="$green7" bg="$green2">
          <XStack items="center" gap="$2">
            <Check size={20} color="$green10" />
            <Text fontSize="$6" fontWeight="800" color="$color12">
              Added {usd(submit.addedCents)}
            </Text>
          </XStack>
          <Text fontSize="$4" color="$color11">
            New balance: <Text fontWeight="800" color="$color12">{usd(submit.balanceCents)}</Text>
          </Text>
          <XStack gap="$2">
            <Button size="$3" theme="light" onPress={reset}>
              Add more
            </Button>
            <Button size="$3" chromeless iconAfter={<ArrowRight size={15} />} onPress={() => router.push('/billing')}>
              Back to billing
            </Button>
          </XStack>
        </Card>
      ) : (
        <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor" maxW={560}>
          {ready && !isLiveSquareEnv(ready.environment) ? (
            <XStack items="center" gap="$2" p="$2.5" rounded="$3" bg="$yellow2" borderWidth={1} borderColor="$yellow6">
              <FlaskConical size={15} color="$yellow10" />
              <Text fontSize="$2" color="$color11">
                Test mode (Square sandbox) — no real charge. Use test card 4111 1111 1111 1111, any future
                expiry, any CVV, ZIP 12345.
              </Text>
            </XStack>
          ) : null}

          {/* Amount */}
          <YStack gap="$2">
            <Text fontSize="$3" fontWeight="700" color="$color12">
              Amount
            </Text>
            <XStack gap="$2" flexWrap="wrap">
              {PRESET_TOPUP_USD.map((v) => {
                const selected = cents === v * 100
                return (
                  <Button
                    key={v}
                    size="$2"
                    bg={selected ? '$color5' : 'transparent'}
                    borderWidth={1}
                    borderColor="$borderColor"
                    onPress={() => setAmount(String(v))}
                    disabled={submit.state === 'submitting'}
                  >
                    ${v}
                  </Button>
                )
              })}
            </XStack>
            <XStack items="center" gap="$2">
              <Text fontSize="$5" color="$color11">
                $
              </Text>
              <Input
                flex={1}
                value={amount}
                onChangeText={setAmount}
                placeholder="25.00"
                keyboardType="decimal-pad"
                disabled={submit.state === 'submitting'}
                maxW={160}
              />
            </XStack>
            {amount.length > 0 && amountError ? (
              <Text fontSize="$2" color="$red10">
                {amountError}
              </Text>
            ) : null}
          </YStack>

          {/* Card field — Square's own iframe mounts here (we never see the PAN) */}
          <YStack gap="$2">
            <Text fontSize="$3" fontWeight="700" color="$color12">
              Card
            </Text>
            <Card p="$3" borderWidth={1} borderColor="$borderColor" bg="$color1">
              <div ref={card.containerRef} id="hz-card-container" style={{ minHeight: 42 }} />
              {cardPhase === 'mounting' ? (
                <Text fontSize="$2" color="$color10">
                  Loading secure card field…
                </Text>
              ) : null}
              {cardPhase === 'error' ? (
                <Text fontSize="$2" color="$red10">
                  {card.error || 'Could not load the card form.'}
                </Text>
              ) : null}
            </Card>
            <XStack items="center" gap="$1.5">
              <ShieldCheck size={13} color="$green10" />
              <Text fontSize="$1" color="$color10">
                Card details go directly to Square and are encrypted. Hanzo never sees your card number.
              </Text>
            </XStack>
          </YStack>

          {submit.state === 'error' ? (
            <XStack p="$2.5" rounded="$3" bg="$red2" borderWidth={1} borderColor="$red6">
              <Text fontSize="$2" color="$red10">
                {submit.message}
              </Text>
            </XStack>
          ) : null}

          <PrimaryButton
            size="$4"
            icon={<CreditCard size={16} />}
            disabled={!canPay}
            opacity={canPay ? 1 : 0.6}
            onPress={() => void pay()}
          >
            {submit.state === 'submitting'
              ? 'Processing…'
              : cents !== null && !amountError
                ? `Pay ${usd(cents)}`
                : 'Enter an amount'}
          </PrimaryButton>
        </Card>
      )}

      {/* Secondary: crypto stays available */}
      <XStack items="center" gap="$1.5">
        <Coins size={14} opacity={0.7} />
        <Text
          fontSize="$2"
          color="$color11"
          cursor="pointer"
          hoverStyle={{ color: '$color12' }}
          onPress={() => router.push('/wallet')}
        >
          Prefer crypto? Top up with HUSD →
        </Text>
      </XStack>
    </>
  )
}

