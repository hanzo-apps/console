'use client'

/**
 * Sign-in / create-account card — multi-tenant credential entry (HIP-0111).
 *
 * The console resolves a user's ORG from their email (not the brand's own org),
 * so a customer in any org signs in here with email + password: we POST the
 * canonical IAM login with `organization: ""` (see `lib/auth/iam-login`), get an
 * OAuth code, and complete the SAME `/v1/iam/signin` exchange the redirect flow uses.
 *
 * CREATE ACCOUNT (self-serve email signup): a net-new stranger toggles to signup,
 * which POSTs `/auth/signup` — the BFF mints an account + its own org (as admin) —
 * then this form signs them in with the same credentials via the identical login
 * path, so they land in the console as the admin of their new workspace. Social
 * signup for a brand-new user needs the IAM app's signup enabled (separate); email
 * signup is the guaranteed path.
 *
 * Social buttons start IAM's hosted provider flow (IAM owns each provider's
 * OAuth — client id, scope, callback). Accounts that require two-factor finish
 * on IAM's same-site hosted page (the IAM session cookie is `SameSite=Lax`, so a
 * cross-site fetch can't carry the MFA challenge) — we hand off with a redirect
 * rather than fake an inline step.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Anchor, Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Apple, Github, Gitlab, Wallet } from '@hanzogui/lucide-icons-2'
import { useAnalytics } from '@hanzo/capture/react'
import { EVENTS } from '@hanzo/capture'

import { branding } from '~/config'
import { HanzoMark } from '~/components/ui/Loader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { Turnstile, turnstileConfigured } from '~/components/ui/Turnstile'
import { useSession } from '~/lib/auth/session'
import { getSigninUrl } from '~/lib/auth/iam'
import { FALLBACK_PROVIDERS, fetchSignInProviders, type SignInProvider } from '~/lib/auth/providers'
import { loginState, loginWithPassword } from '~/lib/auth/iam-login'
import { signUp } from '~/lib/auth/signup'

type Mode = 'signin' | 'signup'

/** Button presentation per IAM provider TYPE — an unknown type renders nothing
 * (honest: never a button the flow can't finish). Web3 reads "Connect Wallet"
 * to match the multi-chain SIWx hand-off. */
function socialSpec(type: string): { label: string; icon: React.ReactElement } | null {
  switch (type) {
    case 'GitHub':
      return { label: 'Continue with GitHub', icon: <Github size={18} /> }
    case 'Google':
      return { label: 'Continue with Google', icon: <GoogleMark /> }
    case 'GitLab':
      return { label: 'Continue with GitLab', icon: <Gitlab size={18} /> }
    case 'Apple':
      return { label: 'Continue with Apple', icon: <Apple size={18} /> }
    case 'Web3Onboard':
    case 'Web3':
      return { label: 'Connect Wallet', icon: <Wallet size={18} /> }
    default:
      return null
  }
}

/** A `?ref=<code>` on the landing URL — passed to signup to credit the referrer's
 *  waitlist position. Read at submit so a link opened straight on /signin still works. */
function refFromUrl(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (new URLSearchParams(window.location.search).get('ref') ?? '').trim()
  } catch {
    return ''
  }
}

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

function CardShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" p="$4">
      <Card p="$5" gap="$4" width={380} borderWidth={1} borderColor="$borderColor" bg="$color1">
        <YStack items="center" gap="$3">
          <HanzoMark size={40} />
          <YStack items="center" gap="$1">
            <Text fontSize="$7" fontWeight="800">
              {branding.name}
            </Text>
            <Text fontSize="$3" color="$color11" text="center">
              {subtitle}
            </Text>
          </YStack>
        </YStack>
        {children}
      </Card>
      <Text fontSize="$1" color="$color9" text="center" mt="$3">
        {branding.productLine}
      </Text>
    </YStack>
  )
}

export function SignInForm() {
  const { completeSignIn, signInWith, establishConsoleSession } = useSession()
  // Live sign-in providers from IAM (the app's real list); fallback until it lands.
  const [providers, setProviders] = useState<SignInProvider[] | null>(null)
  useEffect(() => {
    let on = true
    void fetchSignInProviders().then((p) => {
      if (on && p) setProviders(p)
    })
    return () => {
      on = false
    }
  }, [])
  const analytics = useAnalytics()
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mfa, setMfa] = useState(false)
  // Turnstile token for the signup path (only required when Turnstile is provisioned).
  const [captcha, setCaptcha] = useState('')

  // Open the signup funnel when the create-account view is shown (a mode toggle here,
  // not a route), so the funnel starts from one event on every host.
  useEffect(() => {
    if (mode === 'signup') analytics.capture(EVENTS.SIGNUP_VIEWED)
  }, [mode, analytics])

  // The ONE credential login path — shared by sign-in and by post-signup auto-login.
  async function logInWithCredentials(): Promise<void> {
    const res = await loginWithPassword(email.trim(), password)
    if (res.kind === 'code') {
      await completeSignIn(res.code, loginState(), res.verifier)
      // `res.verifier` is present ONLY on an admin host, where completeSignIn already
      // established the console's OWN durable session (the BFF PKCE redemption). A tenant
      // login upgrades its casibase session to the durable console session here (server-
      // side password grant, gated by that session). Best-effort: it never throws, and a
      // failure leaves the user signed in on the casibase session — so login is never
      // blocked. MFA accounts don't reach here (they hand off to the hosted flow), so
      // this never bypasses MFA.
      if (!res.verifier) await establishConsoleSession(email.trim(), password)
      router.replace('/')
    } else if (res.kind === 'mfa') {
      setMfa(true)
    } else {
      setError(res.message)
      setBusy(false)
    }
  }

  async function submitSignIn() {
    if (busy || !email || !password) return
    setBusy(true)
    setError(null)
    try {
      await logInWithCredentials()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  async function submitSignUp() {
    if (busy || !email || !password) return
    // When Turnstile is provisioned, a solved challenge is required before we spend a
    // signup attempt (the server enforces this too — this is just early UX feedback).
    if (turnstileConfigured() && !captcha) {
      setError('Please complete the verification challenge.')
      return
    }
    setBusy(true)
    setError(null)
    analytics.capture(EVENTS.SIGNUP_SUBMITTED)
    try {
      const r = await signUp(email.trim(), password, { turnstileToken: captcha, ref: refFromUrl() })
      if (r.kind === 'exists') {
        setError('An account with this email already exists — sign in below.')
        setMode('signin')
        setBusy(false)
        return
      }
      if (r.kind === 'error') {
        setError(r.message)
        setBusy(false)
        return
      }
      // Account + org created (self-serve signup has no separate email-verify step) —
      // the funnel completes here, then auto-login lands the new admin in their workspace.
      analytics.capture(EVENTS.SIGNUP_COMPLETED)
      await logInWithCredentials()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your account.')
      setBusy(false)
    }
  }

  const submit = () => (mode === 'signup' ? submitSignUp() : submitSignIn())

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  // Two-factor accounts finish on IAM's same-site hosted page (cross-site cookie
  // limitation). Honest hand-off — not a faked inline step.
  if (mfa) {
    return (
      <CardShell subtitle="Sign in to manage your cloud.">
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

  const signup = mode === 'signup'

  return (
    <CardShell subtitle={signup ? `Create your ${branding.name} account.` : 'Sign in to manage your cloud.'}>
      <YStack gap="$2.5">
        {/* Social buttons render from the app's LIVE IAM provider list (one
            source of truth — a hardcoded button IAM can't honor strands the
            user on the hanzo.id login page). Wallet sign-in hands off to the
            hanzo.id login where the native multi-chain SIWx flow runs
            (connecting a wallet needs a user gesture); it returns an
            authorization code to our /auth/callback like the others. */}
        {(providers ?? FALLBACK_PROVIDERS).map((p) => {
          const spec = socialSpec(p.type)
          if (!spec) return null
          return (
            <Button key={p.name} size="$4" icon={spec.icon} onPress={() => signInWith(p.name)}>
              {spec.label}
            </Button>
          )
        })}
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
          autoComplete={signup ? 'new-password' : 'current-password'}
          value={password}
          onChangeText={setPassword}
          disabled={busy}
          onSubmitEditing={submit}
        />

        {/* Bot wall — only rendered/required in signup mode when Turnstile is
            provisioned (NEXT_PUBLIC_TURNSTILE_SITE_KEY). Otherwise renders nothing. */}
        {signup ? <Turnstile onToken={setCaptcha} /> : null}

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
          {busy ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
        </PrimaryButton>

        {signup ? (
          <Text fontSize="$1" color="$color9" text="center">
            Sign-up is open. Product access rolls out by waitlist position — you'll get
            your spot right after you create your account.
          </Text>
        ) : null}

        {signup ? (
          <Text fontSize="$2" color="$color10" text="center">
            Already have an account?{' '}
            <Anchor fontSize="$2" color="$color11" onPress={() => switchMode('signin')}>
              Sign in
            </Anchor>
          </Text>
        ) : (
          <>
            <Text fontSize="$2" color="$color10" text="center">
              New to {branding.name}?{' '}
              <Anchor fontSize="$2" color="$color11" onPress={() => switchMode('signup')}>
                Create an account
              </Anchor>
            </Text>
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
          </>
        )}
      </YStack>
    </CardShell>
  )
}
