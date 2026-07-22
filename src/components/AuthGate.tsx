'use client'

/**
 * Auth gate — renders children only for a signed-in account.
 *
 * While the session loads, shows a spinner. With no account it sends the visitor to
 * `/signin`. Used to wrap the authenticated dashboard.
 *
 * SPA-FALLBACK CAVEAT (the reason for the `/signin` and `/auth/callback` branches below):
 * the deploy serves the SPA shell (the `/` route's index.html) for EVERY path, so a DIRECT
 * load of `/signin` OR `/auth/callback` mounts THIS gate (the `/` route tree), not that
 * path's own route file. So we render each of those experiences inline here instead of
 * letting the guard fire:
 *   • `/signin` → `<SignIn/>` — the SAME component the `/signin` route renders (a bare
 *     `router.replace('/signin')` would be a no-op and trap the visitor on the spinner).
 *   • `/auth/callback` → `<AuthCallback/>` — the PKCE code→token exchange. It MUST run
 *     before the guard bounces the still-unauthenticated visitor to `/signin`; otherwise
 *     the `?code` is discarded and sign-in dead-loops (this is the console-login break).
 * Everywhere else, an unauthenticated visitor is redirected to `/signin`.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { Loader } from '~/components/ui/Loader'
import { SignIn } from '~/components/SignIn'
import { AuthCallback } from '~/components/AuthCallback'
import { PublicLanding } from '~/components/PublicLanding'
import { useSession } from '~/lib/auth/session'
import { isAdminHost } from '~/config'

type Surface = 'signin' | 'callback' | 'landing' | 'guarded'

export function AuthGate({ children }: { children: ReactNode }) {
  const { account, loading } = useSession()
  const router = useRouter()
  // The REAL browser path, resolved after mount (window is absent during SSR/prerender)
  // — unambiguous under the SPA fallback where the served HTML is the `/` route's shell.
  const [surface, setSurface] = useState<Surface | null>(null)
  useEffect(() => {
    const path = window.location.pathname
    // The public marketing landing is a CONSUMER-host surface (cloud.hanzo.ai /
    // console.hanzo.ai / tenant hosts). The operator cockpit (admin.hanzo.ai) keeps
    // its silent-SSO bounce — anon there → /signin, never marketing.
    const admin = isAdminHost(window.location.host)
    setSurface(
      path === '/signin'
        ? 'signin'
        : path.startsWith('/auth/callback')
          ? 'callback'
          : path === '/' && !admin
            ? 'landing' // root is the public marketing landing for anon (console for authed)
            : 'guarded',
    )
  }, [])

  useEffect(() => {
    // Redirect an unauthenticated visitor to /signin — but never from /signin itself (a
    // same-URL replace is a no-op) nor mid-callback (the exchange is what mints the session).
    if (!loading && !account && surface === 'guarded') router.replace('/signin')
  }, [loading, account, surface, router])

  // At /auth/callback, complete the PKCE exchange FIRST — before the guard can bounce the
  // still-unauthenticated visitor and discard the `?code`.
  if (surface === 'callback') return <AuthCallback />

  // At /signin, the ONE sign-in experience owns the surface (form on a tenant host,
  // silent SSO on an admin host, redirect-to-/ when already signed in).
  if (surface === 'signin') return <SignIn />

  // Root: the marketing landing for an anon visitor (gather interest + explain the
  // product); the signed-in console once there's an account. Never redirects.
  if (surface === 'landing') {
    if (loading) return <Loader />
    if (!account) return <PublicLanding />
    return <>{children}</>
  }

  if (surface === null || loading || !account) return <Loader />
  return <>{children}</>
}
