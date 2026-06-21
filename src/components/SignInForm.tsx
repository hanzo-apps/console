'use client'

/**
 * Sign-in card — adapted from the @hanzo/gui `sign-in-form` recipe.
 *
 * Authentication is delegated to Hanzo IAM (OIDC). Rather than collecting
 * credentials in the console, the card starts the IAM authorize redirect; IAM
 * owns the credential UI and returns to `/auth/callback`.
 */
import { Button, Card, Text, YStack } from '@hanzo/gui'

import { branding } from '~/config'
import { useSession } from '~/lib/auth/session'

export function SignInForm() {
  const { signIn } = useSession()
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" p="$4">
      <Card p="$5" gap="$4" width={380} borderWidth={1} borderColor="$borderColor" bg="$color1">
        <YStack gap="$1">
          <Text fontSize="$7" fontWeight="800">
            {branding.name}
          </Text>
          <Text fontSize="$3" color="$color11">
            Sign in to manage your cloud.
          </Text>
        </YStack>
        <Button theme="blue" size="$4" onPress={signIn}>
          Continue with Hanzo IAM
        </Button>
      </Card>
    </YStack>
  )
}
