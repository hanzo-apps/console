'use client'

/**
 * IAM OAuth callback. IAM redirects here with `?code&state`; we exchange them
 * for a backend session (`/v1/signin`) and land on the dashboard. On failure we
 * surface the error and offer a retry.
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Spinner, Text, YStack } from '@hanzo/gui'

import { ApiError } from '~/lib/api'
import { useSession } from '~/lib/auth/session'

function Callback() {
  const params = useSearchParams()
  const router = useRouter()
  const { completeSignIn } = useSession()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = params.get('code')
    const state = params.get('state')
    if (!code || !state) {
      setError('Missing authorization code.')
      return
    }
    completeSignIn(code, state)
      .then(() => router.replace('/'))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Sign-in failed.'))
  }, [params, completeSignIn, router])

  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" gap="$3">
      {error ? (
        <>
          <Text color="$red10">{error}</Text>
          <Button onPress={() => router.replace('/signin')}>Back to sign in</Button>
        </>
      ) : (
        <>
          <Spinner size="large" color="$color11" />
          <Text color="$color11">Completing sign-in…</Text>
        </>
      )}
    </YStack>
  )
}

export default function CallbackPage() {
  return (
    <Suspense fallback={null}>
      <Callback />
    </Suspense>
  )
}
