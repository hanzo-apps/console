'use client'

/**
 * Onboarding gate — shows the first-run wizard to a signed-in user who has NOT
 * finished onboarding, otherwise renders the console. Sits inside the dashboard
 * layout (after auth + org selection), so it only ever runs for a real user in a
 * real org.
 *
 * It renders the console (children) — never a blocking loader — until the client has
 * hydrated and account preferences are ready, so an already-onboarded user never
 * sees a flash. The wizard is skipped in the static embed (no BFF for MFA/billing)
 * and on the admin host (a customer first-run, not an operator surface).
 */
import { useEffect, useState, type ReactNode } from 'react'

import { useSession } from '~/lib/auth/session'
import { usePreferences } from '~/lib/products/preferences'
import { IS_EMBED } from '~/lib/embed'
import { isComplete, type OnboardingState } from '~/lib/onboarding/steps'
import { isDismissedForSession, dismissForSession, isLocallyComplete } from '~/lib/onboarding/guard'
import { OnboardingWizard } from '~/components/onboarding/OnboardingWizard'

const onAdminHost = (): boolean => typeof window !== 'undefined' && window.location.hostname.startsWith('admin.')

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { account } = useSession()
  const { get, ready } = usePreferences()
  const owner = account?.owner ?? ''
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])
  useEffect(() => {
    if (owner) setDismissed(isDismissedForSession(owner))
  }, [owner])

  // Until hydrated + preferences resolved, show the console (never block on this gate).
  if (!mounted || !ready || !owner || IS_EMBED || onAdminHost()) return <>{children}</>

  const onboarding = get<OnboardingState>('onboarding', {})
  if (isComplete(onboarding) || isLocallyComplete(owner) || dismissed) return <>{children}</>

  return (
    <OnboardingWizard
      initial={onboarding}
      owner={owner}
      onDismiss={() => {
        dismissForSession(owner)
        setDismissed(true)
      }}
    />
  )
}
