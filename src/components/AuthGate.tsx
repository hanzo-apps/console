'use client'

/**
 * Auth gate — renders children only for a signed-in account.
 *
 * While the session loads, shows a spinner. With no account it sends the visitor to
 * `/signin`. Used to wrap the authenticated dashboard.
 *
 * SPA-FALLBACK CAVEAT (the reason for the `/signin` branch below): the deploy serves
 * the SPA shell (the `/` route's index.html) for EVERY path, so a DIRECT load of
 * `/signin` mounts THIS gate (the `/` route tree), not the `/signin` route. A visitor
 * with no account would then have `router.replace('/signin')` be a no-op (the URL is
 * already `/signin`) and be trapped on the spinner forever. So at `/signin` we render
 * the sign-in experience inline instead of redirecting — `<SignIn/>` is the SAME
 * component the `/signin` route renders (and it bounces an already-signed-in visitor
 * back to `/`). Everywhere else, an unauthenticated visitor is redirected to `/signin`.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { Loader } from '~/components/ui/Loader'
import { SignIn } from '~/components/SignIn'
import { useSession } from '~/lib/auth/session'

export function AuthGate({ children }: { children: ReactNode }) {
  const { account, loading } = useSession()
  const router = useRouter()
  // The REAL browser path, resolved after mount (window is absent during SSR/prerender)
  // — unambiguous under the SPA fallback where the served HTML is the `/` route's shell.
  const [atSignin, setAtSignin] = useState<boolean | null>(null)
  useEffect(() => {
    setAtSignin(window.location.pathname === '/signin')
  }, [])

  useEffect(() => {
    // Redirect an unauthenticated visitor to /signin — but never when already there
    // (a same-URL replace is a no-op; we render the form inline at /signin instead).
    if (!loading && !account && atSignin === false) router.replace('/signin')
  }, [loading, account, atSignin, router])

  // At /signin, the ONE sign-in experience owns the surface (form on a tenant host,
  // silent SSO on an admin host, redirect-to-/ when already signed in).
  if (atSignin) return <SignIn />

  if (atSignin === null || loading || !account) return <Loader />
  return <>{children}</>
}
