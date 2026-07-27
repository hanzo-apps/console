'use client'

/**
 * useGuideSignals — assembles the live {@link GuideSignals} for the signed-in user
 * from REAL sources only: the IAM account (owner + role), account preferences
 * (onboarding completion + our own in-console usage map), and a best-effort probe of
 * whether the account holds a Cloud API key. Nothing here is fabricated: an unknown
 * fact (e.g. the key route not wired on a deployment) stays `undefined`, so a step
 * that depends on it renders as not-done rather than a false check.
 *
 * Also exposes `markUsed(id)` — the honest telemetry write: when the user actually
 * opens a product in-console we record it (account preference `guide.used`), which is
 * what lets a getting-started step check itself off across devices.
 */
import { useCallback, useEffect, useState } from 'react'

import { useSession } from '~/lib/auth/session'
import { usePreferences } from '~/lib/products/preferences'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { KeysApi } from '~/lib/api/keys'
import type { OnboardingState } from '~/lib/onboarding/steps'
import {
  USED_PREF_KEY,
  firstRunFromOnboarding,
  roleFrom,
  usedMap,
  withUsed,
  type GuideSignals,
} from './signals'

export interface UseGuideSignals {
  signals: GuideSignals
  /** True once the account + preferences have resolved (avoids a flash of wrong state). */
  ready: boolean
  /** Record that the user opened/acted on a product — honest in-console telemetry. */
  markUsed: (id: string) => void
}

/**
 * The honest usage-telemetry writer, WITHOUT the API-key probe — so mounting it on
 * every product landing (to record "you opened this") costs only a preference read.
 * `useGuideSignals` reuses it; `ProductGuidePanel` uses it alone for pages with no
 * guide, so the key probe fires only where a pitch actually renders.
 */
export function useMarkUsed(): (id: string) => void {
  const { get, set } = usePreferences()
  return useCallback(
    (id: string) => {
      if (!id) return
      const current = usedMap(get<Record<string, boolean>>(USED_PREF_KEY, {}))
      if (current[id]) return
      set(USED_PREF_KEY, withUsed(current, id))
    },
    [get, set],
  )
}

export function useGuideSignals(): UseGuideSignals {
  const { account } = useSession()
  const { get, ready: prefsReady } = usePreferences()
  const isSuperAdmin = useIsSuperAdmin()
  const markUsed = useMarkUsed()
  const owner = account?.owner ?? ''

  const [hasApiKey, setHasApiKey] = useState<boolean | undefined>(undefined)

  // Honest, best-effort: does the account hold a Cloud API key? A failure (route not
  // wired on this deployment, offline) leaves it `undefined` — the get-key step then
  // stays not-done rather than showing a fabricated check. Re-probes per account.
  useEffect(() => {
    if (!owner) {
      setHasApiKey(undefined)
      return
    }
    let live = true
    KeysApi.status()
      .then((s) => {
        if (live) setHasApiKey(Boolean(s?.hasKey))
      })
      .catch(() => {
        if (live) setHasApiKey(undefined)
      })
    return () => {
      live = false
    }
  }, [owner])

  const used = usedMap(get<Record<string, boolean>>(USED_PREF_KEY, {}))
  const onboarding = get<OnboardingState>('onboarding', {})

  const signals: GuideSignals = {
    owner,
    firstRun: firstRunFromOnboarding(onboarding),
    role: roleFrom({ isSuperAdmin, isAdmin: account?.isAdmin, known: Boolean(account) }),
    hasApiKey,
    used,
  }

  return { signals, ready: prefsReady, markUsed }
}
