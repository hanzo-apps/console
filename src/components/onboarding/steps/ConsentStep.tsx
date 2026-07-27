'use client'

/**
 * Step 2 — Data & consent. A required Terms + Privacy acknowledgement and an
 * OPTIONAL "improve models with my data" opt-in (DEFAULT OFF). The choice is
 * persisted onto the account via the onboarding preference (`patch`), so products
 * can honor it. Cannot continue without acknowledging the terms.
 */
import { useState } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { FileText, Sparkles } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'
import { FieldSwitch } from '@hanzo/ui/product'
import { StepShell, StepActions, InlineLink } from '~/components/onboarding/parts'
import type { StepProps } from '~/components/onboarding/types'

export function ConsentStep({ state, patch, next, back, isFirst }: StepProps) {
  const brand = getBrand()
  const [agreed, setAgreed] = useState(Boolean(state.consent?.termsAcceptedAt))
  const [dataSharing, setDataSharing] = useState(Boolean(state.consent?.dataSharing))

  const commit = () => {
    if (!agreed) return
    patch({
      consent: {
        termsAcceptedAt: state.consent?.termsAcceptedAt ?? new Date().toISOString(),
        dataSharing,
      },
    })
    next()
  }

  return (
    <StepShell title="Data & consent" subtitle={`A couple of choices about how ${config.brandName} handles your data.`}>
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" items="flex-start" justify="space-between">
          <XStack gap="$3" items="center" flex={1} minW={0}>
            <YStack width={40} height={40} rounded="$4" items="center" justify="center" bg="$color3">
              <FileText size={20} />
            </YStack>
            <YStack flex={1} minW={0} gap="$1">
              <Text fontSize="$5" fontWeight="700" color="$color12">
                Terms &amp; Privacy
              </Text>
              <Text fontSize="$3" color="$color11">
                I agree to the <InlineLink href={`${brand.websiteUrl}/terms`}>Terms of Service</InlineLink> and{' '}
                <InlineLink href={`${brand.websiteUrl}/privacy`}>Privacy Policy</InlineLink>.
              </Text>
            </YStack>
          </XStack>
          <FieldSwitch checked={agreed} onChange={setAgreed} />
        </XStack>
      </Card>

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" items="flex-start" justify="space-between">
          <XStack gap="$3" items="center" flex={1} minW={0}>
            <YStack width={40} height={40} rounded="$4" items="center" justify="center" bg="$color3">
              <Sparkles size={20} />
            </YStack>
            <YStack flex={1} minW={0} gap="$1">
              <Text fontSize="$5" fontWeight="700" color="$color12">
                Help improve models with my data
              </Text>
              <Text fontSize="$3" color="$color11">
                Optional. Allow anonymized prompts and completions to improve Hanzo models. Off by default — you can change this
                anytime in settings.
              </Text>
            </YStack>
          </XStack>
          <FieldSwitch checked={dataSharing} onChange={setDataSharing} />
        </XStack>
      </Card>

      {!agreed ? (
        <Text fontSize="$2" color="$color10">
          Acknowledge the Terms &amp; Privacy Policy to continue.
        </Text>
      ) : null}

      <StepActions onBack={isFirst ? undefined : back} onContinue={commit} continueDisabled={!agreed} />
    </StepShell>
  )
}
