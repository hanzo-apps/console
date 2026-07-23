'use client'

/**
 * IAM OAuth callback handler — the PKCE code→token exchange.
 *
 * IAM redirects to `/auth/callback?code&state`; `@hanzo/iam` completes the exchange
 * (`handleCallback` reads the code + state + the stored verifier and writes the tokens to
 * sessionStorage), then we hard-navigate back to where a mid-task expiry interrupted the
 * user (default home) so the SessionProvider re-resolves the account from the fresh token.
 * On failure we surface the error and offer a retry.
 *
 * This lives in its OWN component (not inline in the `/auth/callback` route) because the
 * deploy serves the SPA shell — the `/` route tree, guarded by `<Auth/>` — for EVERY
 * path (see Auth's SPA-fallback note). A hard nav to `/auth/callback` therefore mounts
 * Auth, not this route's file; Auth renders THIS component for `/auth/callback`
 * exactly as it renders `<SignIn/>` for `/signin`, so the exchange runs BEFORE the guard
 * can bounce the still-unauthenticated visitor to `/signin` (which would discard `?code`).
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useIam } from '@hanzo/iam/react'
import { Button, Text, YStack } from '@hanzo/gui'

import { Loader } from '~/components/ui/Loader'
import { takeReturnTo } from '~/lib/auth/iam'

export function AuthCallback() {
  const router = useRouter()
  const { handleCallback } = useIam()
  const [error, setError] = useState<string | null>(null)
  // The OAuth `code` is SINGLE-USE and the SDK removes the PKCE verifier BEFORE the
  // token fetch, so the exchange must fire EXACTLY ONCE. Without this guard, React
  // StrictMode's double-invoke (or any `handleCallback` identity change re-running the
  // effect) triggers a second exchange that finds the code consumed / verifier gone and
  // throws — surfacing "Sign-in failed." even though the first exchange succeeded. The
  // ref persists across the double-invoke, so the exchange runs once per page load.
  const exchanged = useRef(false)

  useEffect(() => {
    if (exchanged.current) return
    exchanged.current = true
    let cancelled = false
    handleCallback()
      .then(() => {
        if (cancelled) return
        // Hard navigate so the SessionProvider boots against the new token.
        window.location.assign(takeReturnTo())
      })
      .catch(() => {
        if (!cancelled) setError('Sign-in failed.')
      })
    return () => {
      cancelled = true
    }
  }, [handleCallback])

  if (error) {
    return (
      <YStack flex={1} minH="100vh" items="center" justify="center" gap="$3">
        <Text color="$color12" fontWeight="600">
          {error}
        </Text>
        <Button onPress={() => router.replace('/signin')}>Back to sign in</Button>
      </YStack>
    )
  }
  return <Loader label="Completing sign-in…" />
}
