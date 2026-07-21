'use client'

/**
 * Bridges the console session + App-Router navigation into the shared analytics
 * client (`@hanzo/event`). Rendered once, inside both `SessionProvider` and
 * `AnalyticsProvider` (see `Provider.tsx`), it renders nothing.
 *
 *  - `usePageview` emits a pageview on every path change (the provider fires the
 *    FIRST pageview itself, so this only covers subsequent client navigations).
 *  - `identify` binds the person to the STABLE `owner/name` actor id — the same id
 *    the API client already uses (`setCurrentActor`), never the email — once the
 *    session resolves. The org tenant is stamped server-side from the session, so
 *    we send the user id only. Anonymous placeholder sessions are skipped.
 */
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAnalytics, usePageview } from '@hanzo/event/react'

import { useSession } from '~/lib/auth/session'

export function AnalyticsBridge() {
  const analytics = useAnalytics()
  const { account } = useSession()
  usePageview(usePathname())

  const identified = useRef('')
  useEffect(() => {
    if (!account?.owner || !account?.name || account.type === 'anonymous-user') return
    const personId = `${account.owner}/${account.name}`
    if (identified.current === personId) return
    identified.current = personId
    analytics.identify(personId)
  }, [account, analytics])

  return null
}
