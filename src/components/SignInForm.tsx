'use client'

/**
 * Sign-in card — adapted from the @hanzo/gui `sign-in-form` recipe.
 *
 * Authentication is delegated to Hanzo IAM (OIDC, hanzo.id). The console never
 * collects credentials or reconstructs provider OAuth URLs: every button starts
 * the IAM authorize redirect — the social buttons hint a provider, the primary
 * button opens IAM's email / passkey flow — and IAM owns the rest (provider
 * client ids, callbacks), returning to `/auth/callback`.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Github } from '@hanzogui/lucide-icons-2'

import { branding } from '~/config'
import { HanzoMark } from '~/components/ui/Loader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { useSession } from '~/lib/auth/session'

/** Monochrome Google "G" — the canonical mark, filled with the current text
 * color so it stays black/white with the rest of the console chrome. */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Google">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

export function SignInForm() {
  const { signIn, signInWith } = useSession()
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" p="$4">
      <Card p="$5" gap="$4" width={380} borderWidth={1} borderColor="$borderColor" bg="$color1">
        <YStack items="center" gap="$3">
          <HanzoMark size={40} />
          <YStack items="center" gap="$1">
            <Text fontSize="$7" fontWeight="800">
              {branding.name}
            </Text>
            <Text fontSize="$3" color="$color11">
              Sign in to manage your cloud.
            </Text>
          </YStack>
        </YStack>

        <YStack gap="$2.5">
          <Button size="$4" icon={<Github size={18} />} onPress={() => signInWith('provider-github')}>
            Continue with GitHub
          </Button>
          <Button size="$4" icon={<GoogleMark />} onPress={() => signInWith('provider-google')}>
            Continue with Google
          </Button>

          <XStack items="center" gap="$3" my="$1">
            <YStack flex={1} height={1} bg="$borderColor" />
            <Text fontSize="$2" color="$color10">
              or
            </Text>
            <YStack flex={1} height={1} bg="$borderColor" />
          </XStack>

          <PrimaryButton size="$4" onPress={signIn}>
            Continue with Hanzo ID
          </PrimaryButton>
        </YStack>
      </Card>
    </YStack>
  )
}
