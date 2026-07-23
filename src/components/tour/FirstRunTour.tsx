'use client'

/**
 * FirstRunTour — shows the native guided tour ONCE to a signed-in user, on the home,
 * AFTER onboarding. It renders nothing until it decides to open, so mounting it in the
 * dashboard layout is free.
 *
 * Deferral to onboarding (they must never overlap): the first-run wizard
 * (`Onboard`) takes over the whole surface until it is complete or dismissed on
 * this browser (`~/lib/onboarding/guard`). So the tour auto-opens only once that guard
 * says onboarding is done/dismissed — a brand-new user finishes onboarding first, then
 * sees the tour on their next visit to the home. Per-account + versioned via the tour
 * seen-guard, so it never re-nags.
 */
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

import { useSession } from '~/lib/auth/session'
import { isLocallyComplete, isDismissedForSession } from '~/lib/onboarding/guard'
import { CONSOLE_TOUR, hasSeenTour, markTourSeen } from '~/lib/tour/steps'
import { GuidedTour } from './GuidedTour'

export function FirstRunTour() {
  const { account } = useSession()
  const pathname = usePathname()
  const owner = account?.owner ?? ''

  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const openedRef = useRef(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (openedRef.current || !mounted || !owner) return
    // Only auto-open on the home surface (where the api-key + metrics anchors live).
    if (pathname !== '/') return
    // Already shown for this account/version → never again (settle the ref, no re-check).
    if (hasSeenTour(owner)) {
      openedRef.current = true
      return
    }
    // Defer to onboarding: open only once onboarding is complete/dismissed on this
    // browser. Otherwise leave the ref unset so this re-evaluates when onboarding
    // finishes and the user returns to the home.
    if (isLocallyComplete(owner) || isDismissedForSession(owner)) {
      openedRef.current = true
      setOpen(true)
    }
  }, [mounted, owner, pathname])

  const close = () => {
    setOpen(false)
    if (owner) markTourSeen(owner)
  }

  if (!open) return null
  return <GuidedTour steps={CONSOLE_TOUR} open={open} onClose={close} onFinish={close} />
}

