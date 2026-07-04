'use client'

/**
 * IAM OAuth callback. IAM redirects here with `?code&state`; we exchange them
 * for a backend session (`/v1/iam/signin`) and land on the dashboard. On failure we
 * surface the error and offer a retry.
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Text, YStack } from '@hanzo/gui'

import { ApiError } from '~/lib/api'
import { Loader } from '~/components/ui/Loader'
import { useSession } from '~/lib/auth/session'
import { takeReturnTo } from '~/lib/auth/iam'

function Callback() {
  const params = useSearchParams() ?? new URLSearchParams()
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
      // Land the user back where a mid-task expiry interrupted them (default home).
      .then(() => router.replace(takeReturnTo()))
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
