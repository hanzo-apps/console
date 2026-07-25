'use client'

/**
 * Sign-in experience — the ONE way the console presents sign-in, wherever the user
 * lands on it.
 *
 * @hanzo/iam ONLY: a single "Log in with <brand>" button that starts the IAM redirect +
 * PKCE flow (`useIam().login()`). The button names the ACTIVE brand — the same
 * `config.brandName` the heading above it already reads, resolved from the host — so a
 * Lux or Zoo console never says "Hanzo". IAM owns every credential step — password,
 * social providers, email-code, MFA and wallet all live on its hosted login, so the
 * console never renders an inline password form or reconstructs an IdP URL. On an admin
 * host `config`/`iamConfig` already target the reserved `admin-console` app in the
 * `admin` org, so the SAME one button authenticates the operator into the cockpit.
 *
 * Rendered by BOTH the `/signin` route (`app/signin/page.tsx`) AND `Auth`: the
 * deploy serves the SPA shell for every path, so a direct load of `/signin` mounts the
 * dashboard tree (Auth), not the `/signin` route — Auth defers to this
 * component so `/signin` resolves without depending on a navigation.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useIam } from '@hanzo/iam/react'
import { Text, YStack } from '@hanzo/gui'

import { Loader } from '~/components/ui/Loader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { config } from '~/config'
import { useSession } from '~/lib/auth/session'

export function SignIn() {
  const { account, loading } = useSession()
  const { login } = useIam()
  const router = useRouter()

  useEffect(() => {
    // Already authenticated -> the cockpit.
    if (!loading && account) router.replace('/')
  }, [loading, account, router])

  if (loading || account) return <Loader label="Signing in…" />

  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" gap="$5" p="$4">
      <YStack items="center" gap="$2">
        <Text fontSize="$8" fontWeight="700" color="$color12">
          {config.brandName}
        </Text>
        <Text color="$color11">Sign in to your account</Text>
      </YStack>
      <PrimaryButton size="$5" onPress={() => void login()}>
        Log in with {config.brandName}
      </PrimaryButton>
    </YStack>
  )
}
