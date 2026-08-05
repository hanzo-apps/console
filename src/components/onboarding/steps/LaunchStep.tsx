'use client'

/**
 * Step 6 — You're ready. First-action CTAs that complete onboarding and drop the
 * user straight into a real product route. Selecting any tile (or "Go to console")
 * marks onboarding complete and navigates.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { MessageSquare, Sparkles, KeyRound, Rocket, PartyPopper, ArrowLeft } from '@hanzogui/lucide-icons-2'
import { useAnalytics } from '@hanzo/event/react'
import { EVENTS } from '@hanzo/event'

import { config } from '~/config'
import { StepShell, ChoiceCard } from '~/components/onboarding/parts'
import type { StepProps } from '~/components/onboarding/types'
import { PrimaryButton } from '@hanzo/ui/product'

const TILES: { icon: typeof MessageSquare; title: string; description: string; to: string }[] = [
  { icon: MessageSquare, title: 'Start a chat', description: 'Talk to the latest Zen model right now.', to: '/chat' },
  { icon: Sparkles, title: 'Open the Playground', description: 'Compare models, prompts, and parameters.', to: '/playground' },
  { icon: KeyRound, title: 'Create an API key', description: 'Call the gateway from your own code.', to: '/api-keys' },
  { icon: Rocket, title: 'Deploy a project', description: 'Ship an app on the Hanzo platform.', to: '/applications' },
]

export function LaunchStep({ finish, back, isFirst }: StepProps) {
  const analytics = useAnalytics()
  return (
    <StepShell title="You're ready" subtitle={`Welcome to ${config.brandName}. Pick a first move — you can find everything else in the sidebar.`}>
      <Card p="$4" gap="$2" borderWidth={1} borderColor="$green7" bg="$green2">
        <XStack gap="$2" items="center">
          <PartyPopper size={20} color="var(--green11)" />
          <Text fontSize="$5" fontWeight="700" color="$green11">
            Your workspace is set up
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Two-factor, consent, workspace, credits, and AI access are all configured.
        </Text>
      </Card>

      <YStack gap="$2.5">
        {TILES.map((t) => {
          const Icon = t.icon
          return (
            <ChoiceCard
              key={t.to}
              icon={<Icon size={20} />}
              title={t.title}
              description={t.description}
              onPress={() => {
                // The new user's first meaningful move out of onboarding into a product.
                analytics.capture(EVENTS.FIRST_ACTION, { to: t.to })
                finish(t.to)
              }}
            />
          )
        })}
      </YStack>

      <XStack gap="$3" items="center" justify="space-between" flexWrap="wrap" pt="$2">
        {isFirst ? (
          <YStack />
        ) : (
          <Button size="$3" chromeless icon={<ArrowLeft size={16} />} onPress={back}>
            Back
          </Button>
        )}
        <PrimaryButton size="$4" onPress={() => finish()}>
          Go to console
        </PrimaryButton>
      </XStack>
    </StepShell>
  )
}
