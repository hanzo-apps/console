'use client'

/**
 * Sign-in experience — the ONE way the console presents sign-in, wherever the user
 * lands on it.
 *
 * TENANT host (console.<brand>): the credential form (email/password + social), which
 * resolves the user's org by email.
 *
 * ADMIN host (admin.<brand>): NO second manual form. The admin guard has already
 * authenticated the operator at the brand IAM (a live SSO session), so the console
 * silently (re)authorizes the PUBLIC `admin-console` client against that session and
 * returns via `/auth/callback` — ONE login reaches the operator cockpit (the whole
 * point of the admin.hanzo.ai cutover). See `startAdminSignin`.
 *
 * Rendered by BOTH the `/signin` route (`app/signin/page.tsx`) AND `AuthGate`: the
 * deploy serves the SPA shell for every path, so a direct load of `/signin` mounts the
 * dashboard tree (AuthGate), not the `/signin` route — AuthGate defers to this
 * component so `/signin` resolves to the form without depending on a navigation.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { SignInForm } from '~/components/SignInForm'
import { Loader } from '~/components/ui/Loader'
import { isAdminHost } from '~/config'
import { useSession } from '~/lib/auth/session'
import { startAdminSignin } from '~/lib/auth/iam-login'

export function SignIn() {
  const { account, loading } = useSession()
  const router = useRouter()
  // Host-derived, so resolved AFTER mount (window is absent during SSR). Null until
  // then keeps SSR and hydration in agreement AND never flashes the manual form on an
  // admin host before the silent-SSO redirect fires.
  const [admin, setAdmin] = useState<boolean | null>(null)
  const started = useRef(false)

  useEffect(() => {
    setAdmin(isAdminHost(window.location.hostname))
  }, [])

  useEffect(() => {
    if (loading || admin === null) return
    // Already authenticated → the cockpit. Never (re)trigger SSO for a live session.
    if (account) {
      router.replace('/')
      return
    }
    // Tenant host keeps the manual form; only an admin host auto-initiates.
    if (!admin || started.current) return
    // Loop guard: never re-initiate while an OAuth response is being processed (the
    // code/error rides `/auth/callback`, not here — belt and suspenders).
    const q = new URLSearchParams(window.location.search)
    if (q.has('code') || q.has('error')) return
    started.current = true
    void startAdminSignin()
  }, [loading, account, admin, router])

  // Admin host (or still resolving): never the manual form — a loader covers the
  // one-tick silent-SSO redirect. Tenant host: the standard credential form.
  if (admin === null || admin) return <Loader label="Signing in…" />
  return <SignInForm />
}
