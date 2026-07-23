'use client'

/**
 * Auth — the `signin` stage view. It owns every UN-authenticated entry surface and
 * renders exactly one, chosen by the `surface` the entry resolved from the URL:
 *   • `callback` → <AuthCallback/> — complete the PKCE code→token exchange FIRST, before
 *     any guard could bounce the still-unauthenticated visitor and discard the `?code`.
 *   • `signin`   → <SignIn/> — the ONE sign-in experience (a signed-in visitor here is
 *     bounced to `/` by SignIn itself).
 *   • `landing`  → <PublicLanding/> — the public marketing page for an anon visitor at `/`
 *     on a consumer host.
 *   • `guarded`  → a neutral loader while it redirects an anon visitor to `/signin`.
 *
 * SPA-FALLBACK CAVEAT: the deploy serves the `/` route's shell for every path, so a direct
 * load of `/signin` or `/auth/callback` mounts THIS tree, not that path's own route file —
 * hence each experience is rendered inline here rather than by a navigation.
 *
 * This view only ever renders for the `signin` stage (see resolve): an authenticated
 * landing/guarded visitor advances past it, so there is no "render the app" branch here.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { Loader } from '~/components/ui/Loader'
import { SignIn } from '~/components/SignIn'
import { AuthCallback } from '~/components/AuthCallback'
import { PublicLanding } from '~/components/PublicLanding'
import { useSession } from '~/lib/auth/session'
import type { Surface } from './resolve'

export function Auth({ surface }: { surface: Surface }) {
  const { account, loading } = useSession()
  const router = useRouter()

  useEffect(() => {
    // A definitively-unauthenticated visitor on a guarded path → normalize the URL to
    // /signin (never while loading — the session may still resolve to an account; and
    // never from /signin itself, where a same-URL replace is a no-op).
    if (surface === 'guarded' && !loading && !account) router.replace('/signin')
  }, [surface, loading, account, router])

  if (surface === 'callback') return <AuthCallback />
  if (surface === 'signin') return <SignIn />
  if (surface === 'landing' && !loading && !account) return <PublicLanding />
  // Pre-mount, loading, or the brief redirecting/advancing window.
  return <Loader />
}
