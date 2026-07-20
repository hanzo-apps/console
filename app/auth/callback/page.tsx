'use client'

/**
 * IAM OAuth callback. IAM redirects here with `?code&state`; `@hanzo/iam` completes the
 * PKCE token exchange (`handleCallback` reads the code + state + the stored verifier),
 * then we land the user back where a mid-task expiry interrupted them (default home). A
 * hard navigation lets the SessionProvider re-resolve the account from the fresh token.
 * On failure we surface the error and offer a retry.
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useIam } from '@hanzo/iam/react'
import { Button, Text, YStack } from '@hanzo/gui'

import { Loader } from '~/components/ui/Loader'
import { takeReturnTo } from '~/lib/auth/iam'

function Callback() {
  const router = useRouter()
  const { handleCallback } = useIam()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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

export default function CallbackPage() {
  return (
    <Suspense fallback={null}>
      <Callback />
    </Suspense>
  )
}
