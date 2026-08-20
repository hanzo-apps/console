'use client'

/**
 * Bridges the console session + App-Router navigation into the shared analytics
 * client (`@hanzo/event`). Rendered once, inside both `SessionProvider` and
 * `AnalyticsProvider` (see `Provider.tsx`), it renders nothing.
 *
 *  - `usePageview` emits a pageview on every path change (the provider fires the
 *    FIRST pageview itself, so this only covers subsequent client navigations).
 *  - `identify` binds the user to their Hanzo IAM user id (`account.userId`, the
 *    OIDC `sub`) — never the email — once the session resolves. The org tenant is
 *    stamped server-side from the validated bearer, so we send the user only.
 *    Anonymous placeholder sessions are skipped.
 *
 * WHY NOT `owner/name`. This used to identify by the `${owner}/${name}` actor ref.
 * That is an org-relative REFERENCE, not a user id: it is a different id space
 * from the one hanzo.ai and hanzo.chat identify by (the IAM `sub`), so the same
 * user counted twice the moment they used two Hanzo surfaces — and every
 * cross-property funnel, retention curve and path silently measured nothing. It
 * also moves when an org or a login handle is renamed, which rewrites history.
 */
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAnalytics, usePageview } from '@hanzo/event/react'

import { useSession } from '~/lib/auth/session'
import { primeBearer } from '~/lib/event'

export function AnalyticsBridge() {
  const analytics = useAnalytics()
  const { account } = useSession()
  usePageview(usePathname())

  const identified = useRef('')
  useEffect(() => {
    if (account?.type === 'anonymous-user') return
    // No IAM subject means no IAM user — leave the visitor anonymous rather than
    // inventing an id for them. Identity flows from the token's own claims.
    const userId = account?.userId
    if (!userId || identified.current === userId) return
    // `identify` is one of the kinds the anonymous lane REFUSES, so sending it with
    // a lapsed bearer loses it silently behind a 200. Settle any due refresh first;
    // the dedupe happens at send time so two effect runs still identify once.
    let cancelled = false
    void primeBearer().then(() => {
      if (cancelled || identified.current === userId) return
      identified.current = userId
      analytics.identify(userId)
    })
    return () => {
      cancelled = true
    }
  }, [account, analytics])

  return null
}
