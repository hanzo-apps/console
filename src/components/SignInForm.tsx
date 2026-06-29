'use client'

/**
 * Sign-in card — multi-tenant credential entry (HIP-0111).
 *
 * The console resolves a user's ORG from their email (not the brand's own org),
 * so a customer in any org signs in here with email + password: we POST the
 * canonical IAM login with `organization: ""` (see `lib/auth/iam-login`), get an
 * OAuth code, and complete the SAME `/v1/signin` exchange the redirect flow uses.
 *
 * Social buttons start IAM's hosted provider flow (IAM owns each provider's
 * OAuth — client id, scope, callback). Accounts that require two-factor finish
 * on IAM's same-site hosted page (the IAM session cookie is `SameSite=Lax`, so a
 * cross-site fetch can't carry the MFA challenge) — we hand off with a redirect
 * rather than fake an inline step.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Anchor, Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Github } from '@hanzogui/lucide-icons-2'

import { branding } from '~/config'
import { HanzoMark } from '~/components/ui/Loader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { useSession } from '~/lib/auth/session'
import { getSigninUrl } from '~/lib/auth/iam'
import { loginState, loginWithPassword } from '~/lib/auth/iam-login'

/** Monochrome Google "G" — filled with the current text color so it tracks the
 * console's black/white chrome. */
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

function CardShell({ children }: { children: React.ReactNode }) {
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
        {children}
      </Card>
    </YStack>
  )
}

export function SignInForm() {
  const { completeSignIn, signInWith } = useSession()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mfa, setMfa] = useState(false)

  async function submit() {
    if (busy || !email || !password) return
    setBusy(true)
    setError(null)
    try {
      const res = await loginWithPassword(email.trim(), password)
      if (res.kind === 'code') {
        await completeSignIn(res.code, loginState())
        router.replace('/')
      } else if (res.kind === 'mfa') {
        setMfa(true)
      } else {
        setError(res.message)
        setBusy(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  // Two-factor accounts finish on IAM's same-site hosted page (cross-site cookie
  // limitation). Honest hand-off — not a faked inline step.
  if (mfa) {
    return (
      <CardShell>
        <YStack gap="$3" items="center">
          <Text fontSize="$5" fontWeight="700">
            Two-factor required
          </Text>
          <Text fontSize="$3" color="$color11" text="center">
            Your account uses two-factor authentication. Continue on the secure Hanzo ID page to
            enter your code.
          </Text>
          <PrimaryButton size="$4" width="100%" onPress={() => window.location.assign(getSigninUrl())}>
            Continue on Hanzo ID
          </PrimaryButton>
          <Button size="$3" chromeless onPress={() => { setMfa(false); setBusy(false) }}>
            Back
          </Button>
        </YStack>
      </CardShell>
    )
  }

  return (
    <CardShell>
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

        <Input
          size="$4"
          placeholder="Email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          disabled={busy}
        />
        <Input
          size="$4"
          placeholder="Password"
          // secureTextEntry alone did not mask in this @hanzo/gui build; set the
          // web input type explicitly so the password is masked (RNW passthrough).
          secureTextEntry
          {...{ type: 'password' }}
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          disabled={busy}
          onSubmitEditing={submit}
        />

        {error ? (
          <Text fontSize="$2" color="$red10" role="alert">
            {error}
          </Text>
        ) : null}

        <PrimaryButton
          size="$4"
          disabled={busy || !email || !password}
          icon={busy ? <Spinner size="small" /> : undefined}
          onPress={submit}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </PrimaryButton>

        <Text fontSize="$2" color="$color10" text="center">
          Trouble signing in?{' '}
          <Anchor
            fontSize="$2"
            color="$color11"
            onPress={() => window.location.assign(getSigninUrl())}
          >
            Use a passkey or recovery
          </Anchor>
        </Text>
      </YStack>
    </CardShell>
  )
}
