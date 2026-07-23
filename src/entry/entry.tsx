'use client'

/**
 * Entry — the console's ONE entry gate. It gathers the session with hooks, computes ONE
 * `stage` value (`resolve`), and renders EXACTLY one surface. No gate-after-gate: the
 * whole decision is a value, the render is a flat switch. Fail-closed lives in `resolve`
 * — the dashboard (this file's `ready` branch) renders only for a loaded, authenticated,
 * org-ENTERED session; every earlier or unresolved state renders an earlier surface.
 *
 * Layering: `Preferences` + `Toast` sit ABOVE this component (the dashboard layout mounts
 * them) — the resolver reads the onboarding preference, and the onboard wizard + every
 * module report through Toast. The `ready`-only app-shell providers are the flat
 * `Providers` list, mounted only in the `ready` branch.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { YStack } from '@hanzo/gui'

import { resolve, type Session, type Surface } from './resolve'
import { Auth } from './auth'
import { Waitlist } from './waitlist'
import { Scope, AdminBanner } from './scope'
import { Onboard } from './onboard'
import { Dashboard } from './dashboard'
import { Providers } from './providers'
import { ProjectDeepLink } from '~/components/ProjectDeepLink'
import { FirstRunTour } from '~/components/tour/FirstRunTour'
import { useSession } from '~/lib/auth/session'
import { usePreferences } from '~/lib/products/preferences'
import { useWaitlist } from '~/lib/auth/waitlist'
import { isSuperAdminAccount } from '~/lib/auth/admin'
import { isAdminHost } from '~/config'
import { hasSelectedOrg } from '~/lib/org-scope'
import { isComplete, type OnboardingState } from '~/lib/onboarding/steps'
import { isLocallyComplete, isDismissedForSession, dismissForSession } from '~/lib/onboarding/guard'
import { IS_EMBED } from '~/lib/embed'

/** The URL → entry surface, resolved after mount (the SPA shell is `/` for every path). */
function surfaceOf(): Exclude<Surface, null> {
  const path = window.location.pathname
  if (path === '/signin') return 'signin'
  if (path.startsWith('/auth/callback')) return 'callback'
  // `/` is the public marketing landing on a consumer host; an admin host keeps its
  // silent-SSO bounce (guarded → /signin), never the marketing page.
  if (path === '/' && !isAdminHost(window.location.host)) return 'landing'
  return 'guarded'
}

export function Entry({ children }: { children: ReactNode }) {
  const { account, loading } = useSession()
  const prefs = usePreferences()
  const owner = account?.owner ?? ''
  const superAdmin = isSuperAdminAccount(account)
  // Host is stable across hydration → read synchronously; the URL PATH is unambiguous only
  // client-side under the SPA fallback → read after mount (`surface`).
  const adminHost = typeof window !== 'undefined' && isAdminHost(window.location.host)
  const operator = adminHost || superAdmin

  const waitlist = useWaitlist(!operator)

  const [surface, setSurface] = useState<Surface>(null)
  const [orgEntered, setOrgEntered] = useState<boolean | null>(null)
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setMounted(true)
    setSurface(surfaceOf())
  }, [])
  useEffect(() => {
    setOrgEntered(hasSelectedOrg())
    setDismissed(owner ? isDismissedForSession(owner) : false)
  }, [owner])

  // "Finish later" — hide the onboarding stage for the session (still resumable next one).
  const onDismiss = useCallback(() => {
    if (owner) dismissForSession(owner)
    setDismissed(true)
  }, [owner])

  const session: Session = {
    loading,
    authed: Boolean(account),
    surface,
    owner,
    adminHost,
    superAdmin,
    waitlistLoading: waitlist.loading,
    access: waitlist.view?.hasAccess ?? false,
    orgEntered,
    onboardable: !IS_EMBED && !adminHost,
    onboardReady: mounted && prefs.ready,
    onboarded:
      isComplete(prefs.get<OnboardingState>('onboarding', {})) ||
      (owner ? isLocallyComplete(owner) : false) ||
      dismissed,
  }

  switch (resolve(session)) {
    case 'signin':
      return <Auth surface={surface} />
    case 'waitlist':
      return <Waitlist status={waitlist.view?.status ?? null} loading={waitlist.loading} onReload={waitlist.reload} />
    case 'org':
      return <Scope owner={owner} entered={orgEntered} adminHost={adminHost} superAdmin={superAdmin} />
    case 'onboard':
      return <Onboard owner={owner} onDismiss={onDismiss} />
    case 'ready':
      // The app, under the flat provider stack. ProjectDeepLink honors an inbound ?project=
      // (renders null); AdminBanner is a self-guarding operator strip; FirstRunTour renders
      // null until it decides to open (once, on the home, after onboarding).
      return (
        <Providers>
          <ProjectDeepLink />
          <YStack flex={1}>
            <AdminBanner />
            <Dashboard>{children}</Dashboard>
          </YStack>
          <FirstRunTour />
        </Providers>
      )
  }
}
