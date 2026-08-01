'use client'

/**
 * Bridges the console session + App-Router navigation into the shared analytics
 * client (`@hanzo/event`). Rendered once, inside both `SessionProvider` and
 * `AnalyticsProvider` (see `Provider.tsx`), it renders nothing.
 *
 *  - `usePageview` emits a pageview on every path change (the provider fires the
 *    FIRST pageview itself, so this only covers subsequent client navigations).
 *  - `identify` binds the user to their Hanzo IAM user id (`account.userId`, the
 *    OIDC `sub`) once the session resolves, AND carries the attributes that make
 *    that id legible. Anonymous placeholder sessions are skipped.
 *
 * WHY NOT `owner/name`. This used to identify by the `${owner}/${name}` actor ref.
 * That is an org-relative REFERENCE, not a user id: it is a different id space
 * from the one hanzo.ai and hanzo.chat identify by (the IAM `sub`), so the same
 * user counted twice the moment they used two Hanzo surfaces — and every
 * cross-property funnel, retention curve and path silently measured nothing. It
 * also moves when an org or a login handle is renamed, which rewrites history.
 *
 * WHY TRAITS. A bare `identify(id)` writes a user id and nothing else, so the
 * warehouse held a population of opaque subjects: every funnel could count users
 * but no one could say WHICH user, and answering "who hit this error" meant a
 * manual IAM lookup per row. Email and name are FIRST-PARTY facts about our own
 * users — they arrive in the same IAM claims this file already decodes to get the
 * id, and were simply dropped on the floor. Sent as traits they are exactly as
 * sensitive as they were in the token, and the id stays the join key.
 *
 * WHAT IS STILL NOT SENT: the org. The tenant is stamped SERVER-SIDE from the
 * validated bearer, so org-level cohorts are already queryable — and a tenant the
 * client can name is a tenant the client can get wrong. Traits describe the user,
 * never the scope they are trusted with.
 */
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAnalytics, usePageview } from '@hanzo/event/react'

import { useSession } from '~/lib/auth/session'
import { type Account } from '~/lib/api/types'

/** The user attributes worth carrying alongside the id, from the IAM claims the
 *  session already decoded. A key is OMITTED rather than sent undefined, so an
 *  absent claim never overwrites a trait a prior identify established. */
export function identityTraits(account: Account): Record<string, unknown> {
  const traits: Record<string, unknown> = {}
  if (account.email) traits.email = account.email
  const name = account.displayName ?? account.name
  if (name) traits.name = name
  return traits
}

export function AnalyticsBridge() {
  const analytics = useAnalytics()
  const { account } = useSession()
  usePageview(usePathname())

  const identified = useRef('')
  useEffect(() => {
    if (!account || account.type === 'anonymous-user') return
    // No IAM subject means no IAM user — leave the visitor anonymous rather than
    // inventing an id for them. Identity flows from the token's own claims.
    const userId = account.userId
    if (!userId || identified.current === userId) return
    identified.current = userId
    analytics.identify(userId, identityTraits(account))
  }, [account, analytics])

  return null
}
