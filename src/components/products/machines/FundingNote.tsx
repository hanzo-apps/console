'use client'

/**
 * FundingNote — the ONE visual that makes the CPU-credit vs GPU-prepay-card
 * distinction obvious to the customer (DRY: rendered in the launch drawer AND on the
 * Machines / GPUs overviews). It reads the pure `fundingModel` and renders a
 * visually-distinct strip per source, so a non-GPU droplet clearly launches on the
 * credit balance while a GPU clearly requires a card + prepay:
 *   - credit (CPU) → a GREEN strip with a wallet icon ("Launches on your Hanzo
 *     credit · $X available · charged to credits · no card required").
 *   - card (GPU)   → a YELLOW strip with a card icon ("Prepay only · charged to your
 *     card · first hour upfront").
 * When the funding source is empty it surfaces the right add-funds CTA (add credits /
 * add a card). Nothing is fabricated — the credit figure is the real balance when
 * known, and the copy matches what the server enforces on launch.
 */
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { CreditCard, Wallet } from '@hanzogui/lucide-icons-2'

import { fundingModel } from './logic'

/** Navigate to a same-origin add-funds route (add-credits / add-card). */
const goTo = (p: string) => {
  if (typeof window !== 'undefined') window.location.assign(p)
}

export function FundingNote({
  kind,
  creditCents,
  hasCard,
  compact,
}: {
  kind: 'cpu' | 'gpu'
  /** The org's spendable credit balance in cents (CPU); undefined = not yet known. */
  creditCents?: number | null
  /** Whether a payment card is on file (GPU); undefined = not checked here. */
  hasCard?: boolean | null
  /** Tighter padding for inline use inside the launch drawer. */
  compact?: boolean
}) {
  const f = fundingModel(kind, { creditCents, hasCard })
  const credit = f.source === 'credit'
  return (
    <XStack
      items="flex-start"
      gap="$2.5"
      p={compact ? '$2.5' : '$3'}
      rounded="$4"
      borderWidth={1}
      borderColor={credit ? '$green6' : '$yellow6'}
      bg={credit ? '$green2' : '$yellow2'}
    >
      {credit ? <Wallet size={16} color="$green10" /> : <CreditCard size={16} color="$yellow10" />}
      <YStack flex={1} gap="$1">
        <Text fontSize="$2" fontWeight="700" color="$color12">
          {f.headline}
        </Text>
        <Text fontSize="$1" color="$color11">
          {f.detail}
        </Text>
        {f.needsFunds ? (
          <Button
            size="$2"
            self="flex-start"
            theme="light"
            mt="$1"
            icon={credit ? <Wallet size={14} /> : <CreditCard size={14} />}
            onPress={() => goTo(f.cta.href)}
          >
            {f.cta.label}
          </Button>
        ) : null}
      </YStack>
    </XStack>
  )
}
