'use client'

/**
 * The first-run onboarding wizard shell — owns the persisted state + navigation and
 * renders the current step beside the progress rail. Full-takeover (rendered by
 * {@link Onboard} instead of the console shell) so the flow has the user's
 * full attention, Vercel-style.
 *
 * Persistence: the whole onboarding object is written to the account preference
 * `onboarding` (cross-device) via `usePreferences().set`, PLUS a local completion
 * guard (so it sticks even while the `update-preferences` backend endpoint is a gap).
 * A half-finished flow resumes at the saved step next load; a completed one never
 * shows again; "I'll finish later" hides it for the session (still resumable).
 */
import { useReducer, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { useAnalytics } from '@hanzo/event/react'
import { EVENTS } from '@hanzo/event'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { usePreferences } from '~/lib/products/preferences'
import { BrandMark } from '~/components/ui/BrandLogo'
import { FadeIn } from '~/components/ui/FadeIn'
import {
  ONBOARDING_STEPS,
  LAST_INDEX,
  markComplete,
  resumeIndex,
  withStatus,
  withStep,
  type OnboardingState,
  type StepId,
} from '~/lib/onboarding/steps'
import { markLocallyComplete } from '~/lib/onboarding/guard'
import { ProgressRail } from '~/components/onboarding/parts'
import type { StepProps } from '~/components/onboarding/types'
import { SecureStep } from '~/components/onboarding/steps/SecureStep'
import { ConsentStep } from '~/components/onboarding/steps/ConsentStep'
import { TeamStep } from '~/components/onboarding/steps/TeamStep'
import { CreditsStep } from '~/components/onboarding/steps/CreditsStep'
import { AiAccessStep } from '~/components/onboarding/steps/AiAccessStep'
import { LaunchStep } from '~/components/onboarding/steps/LaunchStep'

const STEP_COMPONENTS: Record<StepId, (p: StepProps) => ReactNode> = {
  secure: SecureStep,
  consent: ConsentStep,
  team: TeamStep,
  credits: CreditsStep,
  ai: AiAccessStep,
  launch: LaunchStep,
}

export function OnboardingWizard({
  initial,
  owner,
  onDismiss,
}: {
  initial: OnboardingState
  owner: string
  onDismiss: () => void
}) {
  const router = useRouter()
  const analytics = useAnalytics()
  const { account } = useSession()
  const { set } = usePreferences()
  const stateRef = useRef<OnboardingState>(initial)
  const [index, setIndex] = useState<number>(() => resumeIndex(initial))
  const [, bump] = useReducer((n: number) => n + 1, 0)

  /** Write the working state to the account preference (single owner of `onboarding`). */
  const commit = (nextState: OnboardingState) => {
    stateRef.current = nextState
    set('onboarding', nextState)
    bump()
  }

  const patch = (partial: Partial<OnboardingState>) => commit({ ...stateRef.current, ...partial })

  const goTo = (i: number, status?: 'done' | 'skipped') => {
    const clamped = Math.max(0, Math.min(i, LAST_INDEX))
    const currentId = ONBOARDING_STEPS[index].id
    const nextId = ONBOARDING_STEPS[clamped].id
    const marked = status ? withStatus(stateRef.current, currentId, status) : stateRef.current
    commit(withStep(marked, nextId))
    setIndex(clamped)
  }

  const props: StepProps = {
    state: stateRef.current,
    patch,
    next: () => goTo(index + 1, 'done'),
    skip: () => goTo(index + 1, 'skipped'),
    back: () => goTo(index - 1),
    isFirst: index === 0,
    finish: (destination?: string) => {
      // The signup funnel's terminal conversion — fired once when onboarding completes.
      analytics.capture(EVENTS.SIGNUP_COMPLETED)
      const done = markComplete(withStatus(stateRef.current, 'launch', 'done'), new Date().toISOString())
      commit(done)
      markLocallyComplete(owner || account?.owner || '')
      router.push(destination ?? '/')
    },
  }

  const Step = STEP_COMPONENTS[ONBOARDING_STEPS[index].id]

  return (
    <YStack flex={1} minH="100vh" bg="$color1">
      {/* Top bar: brand + dismiss */}
      <XStack px="$5" py="$3.5" items="center" justify="space-between" borderBottomWidth={1} borderColor="$borderColor">
        <XStack gap="$2.5" items="center">
          {/* Host-derived. The wizard sits beside "Set up {config.brandName}",
              so a hardcoded Hanzo H put the wrong mark next to the right name on
              every lux/zoo/pars host. Same mark SidebarBrand renders. */}
          <BrandMark size={22} />
          <Text fontSize="$4" fontWeight="700" color="$color12">
            Set up {config.brandName}
          </Text>
        </XStack>
        <Button size="$2" chromeless onPress={onDismiss}>
          I'll finish later
        </Button>
      </XStack>

      {/* Body: rail + step card */}
      <YStack flex={1} items="center" py="$6" px="$4">
        <XStack gap="$6" width="100%" maxW={980} items="flex-start" $md={{ flexDirection: 'column' }}>
          <ProgressRail currentIndex={index} status={stateRef.current.status ?? {}} />
          <YStack flex={1} minW={0}>
            <FadeIn key={ONBOARDING_STEPS[index].id}>
              <Card p="$5" gap="$4" borderWidth={1} borderColor="$borderColor" bg="$color1" width="100%">
                <Text fontSize="$1" color="$color10" fontWeight="500">
                  Step {index + 1} of {ONBOARDING_STEPS.length}
                </Text>
                <Step {...props} />
              </Card>
            </FadeIn>
          </YStack>
        </XStack>
      </YStack>
    </YStack>
  )
}
