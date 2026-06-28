'use client'

/**
 * IAM OAuth callback. IAM redirects here with `?code&state` (or `?error`). We:
 *   1. surface any IdP `error`,
 *   2. require `code` + `state`,
 *   3. validate `state` against the value we stored at sign-in start (CSRF /
 *      authorization-code-injection defense) BEFORE exchanging the code,
 *   4. exchange code (+ PKCE verifier) for a backend session, and land on `/`.
 *
 * The exchange runs exactly once (a ref guard) so React's dev double-effect can't
 * consume the one-time state twice and false-flag a mismatch.
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Text, YStack } from '@hanzo/gui'

import { ApiError } from '~/lib/api'
import { Loader } from '~/components/ui/Loader'
import { useSession } from '~/lib/auth/session'
import { consumeState, describeAuthError } from '~/lib/auth/iam'

function Callback() {
  const params = useSearchParams()
  const router = useRouter()
  const { completeSignIn } = useSession()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const idpError = params.get('error')
    if (idpError) {
      setError(describeAuthError(idpError, params.get('error_description')))
      return
    }

    const code = params.get('code')
    const state = params.get('state')
    if (!code || !state) {
      setError('Missing authorization code.')
      return
    }

    // CSRF / code-injection defense: the returned state MUST match the one we
    // stored when starting sign-in. Consume (clear) it either way.
    const expected = consumeState()
    if (!expected || state !== expected) {
      setError('This sign-in could not be verified (state mismatch). Please sign in again.')
      return
    }

    completeSignIn(code, state)
      .then(() => router.replace('/'))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Sign-in failed.'))
  }, [params, completeSignIn, router])

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

export default function CallbackPage() {
  return (
    <Suspense fallback={null}>
      <Callback />
    </Suspense>
  )
}
