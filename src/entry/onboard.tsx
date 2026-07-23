'use client'

/**
 * Onboard — the `onboard` stage view: the first-run wizard. The entry decides WHEN it
 * shows (a signed-in user, in an org, who hasn't finished onboarding, off the static
 * embed / admin host — see resolve); this view just renders the wizard with the account's
 * saved progress. It reads that progress from the account preference (`onboarding`) and
 * `onDismiss` ("finish later") is the entry's — hiding the stage for the session.
 */
import { usePreferences } from '~/lib/products/preferences'
import { type OnboardingState } from '~/lib/onboarding/steps'
import { OnboardingWizard } from '~/components/onboarding/OnboardingWizard'

export function Onboard({ owner, onDismiss }: { owner: string; onDismiss: () => void }) {
  const { get } = usePreferences()
  return <OnboardingWizard initial={get<OnboardingState>('onboarding', {})} owner={owner} onDismiss={onDismiss} />
}
