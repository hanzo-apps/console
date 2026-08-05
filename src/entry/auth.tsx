'use client'

/**
 * Auth — the `signin` stage view. It owns every UN-authenticated entry surface and
 * renders exactly one, chosen by the `surface` the entry resolved from the URL:
 *   • `callback` → <AuthCallback/> — complete the PKCE code→token exchange FIRST, before
 *     any guard could bounce the still-unauthenticated visitor and discard the `?code`.
 *   • `signin`   → <SignIn/> — the ONE sign-in experience (a signed-in visitor here is
 *     bounced to `/` by SignIn itself).
 *   • `guarded`  → a neutral loader while the IAM hop STARTS. An anonymous visitor to the
 *     console has exactly one thing to do, so do it: `/signin`'s entire content is one
 *     button that starts this same hop, and routing through it spent a page load asking
 *     "did you mean it?" — the second such question already, since the visitor clicked
 *     "Sign in" on cloud.hanzo.ai to get here. That double-ask IS the reported bug.
 *
 * WHY THIS IS SAFE FOR SIGN-OUT, the one hazard here: an explicit sign-out lands on
 * `/signin` (session.tsx), which is surface `signin` and keeps its button. IAM may still
 * hold its own session, so auto-authorizing THERE would sign the user straight back in and
 * make signing out impossible. `/signin` is therefore the one surface that never
 * auto-starts — it is also where a callback failure lands, so a broken hop cannot loop.
 *
 * SPA-FALLBACK CAVEAT: the deploy serves the `/` route's shell for every path, so a direct
 * load of `/signin` or `/auth/callback` mounts THIS tree, not that path's own route file —
 * hence each experience is rendered inline here rather than by a navigation.
 *
 * This view only ever renders for the `signin` stage (see resolve): an authenticated
 * guarded visitor advances past it, so there is no "render the app" branch here.
 */
import { useEffect, useRef } from 'react'

import { Loader } from '~/components/ui/Loader'
import { SignIn } from '~/components/SignIn'
import { AuthCallback } from '~/components/AuthCallback'
import { useSession } from '~/lib/auth/session'
import { startReauth } from '~/lib/auth/iam'
import type { Surface } from './resolve'

export function Auth({ surface }: { surface: Surface }) {
  const { account, loading } = useSession()
  // The hop is a full-page navigation, but React may re-run the effect before the browser
  // commits it; starting a second authorize would overwrite the stored PKCE verifier that
  // the first one's `code` will be exchanged against. Once per mount.
  const started = useRef(false)

  useEffect(() => {
    // A definitively-unauthenticated visitor on a guarded path → start the IAM hop (never
    // while loading: the session may still resolve to an account). `startReauth` is the
    // existing composition — stash where they were, THEN authorize — so a deep link like
    // /models returns to /models instead of dumping them on the home.
    if (surface !== 'guarded' || loading || account || started.current) return
    started.current = true
    startReauth()
  }, [surface, loading, account])

  if (surface === 'callback') return <AuthCallback />
  if (surface === 'signin') return <SignIn />
  // Pre-mount, loading, or the brief window while the IAM hop navigates away.
  return <Loader />
}
