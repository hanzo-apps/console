'use client'

/**
 * IAM OAuth callback. IAM redirects here with `?code&state`; we exchange them for a
 * backend session and land on the dashboard. On an ADMIN host the code was minted for
 * the PUBLIC `admin-console` client via PKCE, so we hand `completeSignIn` the verifier
 * `startAdminSignin` stashed for this browser — it then redeems the code through the
 * console's OWN BFF (`/auth/signin`, no secret). Tenant hosts carry no verifier and keep
 * the cloud-backend `/v1/iam/signin` exchange. On failure we surface the error and offer
 * a retry.
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Text, YStack } from '@hanzo/gui'

import { ApiError } from '~/lib/api'
import { Loader } from '~/components/ui/Loader'
import { useSession } from '~/lib/auth/session'
import { takeReturnTo } from '~/lib/auth/iam'
import { takeAdminPkceVerifier } from '~/lib/auth/iam-login'

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
    // The verifier is present ONLY after an admin-host silent SSO (startAdminSignin);
    // undefined on a tenant host, which then keeps the cloud-backend exchange.
    completeSignIn(code, state, takeAdminPkceVerifier())
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
