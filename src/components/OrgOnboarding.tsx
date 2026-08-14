'use client'

/**
 * Org onboarding — the first-run screen for a user who isn't in an organization.
 *
 * Shown by {@link Scope} when the session has no org. Two predictable paths:
 *   - "Create your organization": type a name; we show the exact slug it becomes,
 *     then create the org and make you its admin.
 *   - "Skip — use a personal organization": one click creates a `<username>` org
 *     so EVERYONE always has an org and lands straight in the console.
 *
 * The mutation is the server route `/onboard` (it acts as the confidential
 * console client; the browser only sends its cookie). Because an IAM user's
 * org IS their identity, creating the org moves the user into it — so on success
 * we re-authenticate (sign out → sign in) to mint a session for the new org, and
 * the user arrives in their console. Honest inline errors; never a fake success.
 */
import { useState, type ReactNode } from 'react'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, ArrowRight, Sparkles } from '@hanzogui/lucide-icons-2'

import { useSession } from '~/lib/auth/session'
import { readOnboardRefusal, slugifyOrg, validateOrgName } from '~/lib/server/onboarding'
import { v1Url } from '~/lib/api/client'
import { FadeIn } from '@hanzo/ui/product'

type Phase = 'form' | 'done' | 'exists'

// currentOwner asks the server which organization this account is in. IAM answers
// the legacy envelope ({status,msg,data}) on this address, so read through `data`
// and fall back to a bare body. Any failure returns null and the caller falls back
// to showing the server's own message — a recovery that guesses is worse than none.
async function currentOwner(): Promise<string | null> {
  try {
    const res = await fetch(v1Url('iam/account'), { credentials: 'include' })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { owner?: string }; owner?: string } | null
    const owner = body?.data?.owner ?? body?.owner
    return owner && owner !== 'admin' ? owner : null
  } catch {
    return null
  }
}

export function OrgOnboarding() {
  const { signIn, signOut } = useSession()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<false | 'create' | 'personal'>(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('form')
  // The org the SERVER says this account already admins, discovered only after a
  // refused create. See the 409 branch in onboard().
  const [existingOrg, setExistingOrg] = useState<string | null>(null)

  const slug = slugifyOrg(name)
  const named = validateOrgName(name)
  const canCreate = named.ok && !busy

  async function onboard(payload: { name: string } | { personal: true }, which: 'create' | 'personal') {
    setError(null)
    setBusy(which)
    let res: Response
    try {
      res = await fetch(v1Url('iam/onboard'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      setError('Your organization was not created — the request never reached us. Check your connection and try again.')
      setBusy(false)
      return
    }
    const json = (await res.json().catch(() => null)) as { org?: string; error?: string } | null
    if (!res.ok || !json?.org) {
      // 409 = the FIRST-RUN GATE, not a name collision. Onboarding MOVES the caller
      // into the org it founds, so founding a second one would orphan the org this
      // account already admins — IAM refuses (provision.go: "you already have an
      // organization"). This screen is only ever rendered when the client resolved
      // an EMPTY owner, and an owner that is empty because a read failed looks
      // exactly like a brand-new account. So the refusal is the first reliable
      // signal that the session was wrong, and the only honest thing to do with it
      // is recover: ask the server which org this account is actually in and offer
      // the way in. Leaving the customer on a form that can never submit — with a
      // message about organizations when they just typed a name — is how "it said
      // the name was taken" happens.
      const refusal = readOnboardRefusal(
        res.status,
        json?.error,
        res.status === 409 ? await currentOwner() : null,
      )
      if (refusal.action === 'recover') {
        setExistingOrg(refusal.org)
        setPhase('exists')
      } else {
        setError(refusal.error)
      }
      setBusy(false)
      return
    }
    // Created + joined. Re-authenticate so the new session carries the new org.
    setPhase('done')
    try {
      await signOut()
    } catch {
      // ignore — we re-auth regardless
    }
    signIn()
  }

  if (phase === 'exists' && existingOrg) {
    return (
      <Center>
        <FadeIn style={CENTER_STYLE}>
          <Card p="$5" gap="$4" width={440} borderWidth={1} borderColor="$borderColor" bg="$color1" items="center">
            <Building2 size={20} />
            <YStack gap="$1" items="center">
              <Text fontSize="$6" fontWeight="800">
                You{'\u2019'}re already in {existingOrg}
              </Text>
              <Text fontSize="$3" color="$color11" text="center">
                This account already belongs to an organization, so there was nothing to
                create. Sign in again to continue there.
              </Text>
            </YStack>
            {/* Explicit, never automatic. Re-authenticating on our own would loop
                forever against whatever left the session without an owner. */}
            <Button size="$3" onPress={() => signIn()}>
              Continue to {existingOrg}
            </Button>
          </Card>
        </FadeIn>
      </Center>
    )
  }

  if (phase === 'done') {
    return (
      <Center>
        <FadeIn style={CENTER_STYLE}>
          <Card p="$5" gap="$4" width={440} borderWidth={1} borderColor="$borderColor" bg="$color1" items="center">
            <Spinner size="large" color="$color11" />
            <YStack gap="$1" items="center">
              <Text fontSize="$6" fontWeight="800">
                Organization ready
              </Text>
              <Text fontSize="$3" color="$color11" text="center">
                Signing you in to your new organization…
              </Text>
            </YStack>
            <Button size="$3" chromeless onPress={() => signIn()}>
              Sign in now
            </Button>
          </Card>
        </FadeIn>
      </Center>
    )
  }

  return (
    <Center>
      <FadeIn style={CENTER_STYLE}>
        <Card p="$5" gap="$4" width={440} borderWidth={1} borderColor="$borderColor" bg="$color1">
          <YStack gap="$2">
            <XStack gap="$2" items="center">
              <Building2 size={20} />
              <Text fontSize="$7" fontWeight="800">
                Create your organization
              </Text>
            </XStack>
            <Text fontSize="$3" color="$color11">
              Your account isn’t in an organization yet. Create one to get started — you can
              rename it and invite teammates later.
            </Text>
          </YStack>

          <YStack gap="$2">
            <Text fontSize="$2" color="$color11" fontWeight="600">
              Organization name
            </Text>
            <Input
              value={name}
              onChangeText={(v) => {
                setName(v)
                if (error) setError(null)
              }}
              placeholder="Acme Inc"
              autoCapitalize="words"
              autoFocus
              onSubmitEditing={() => canCreate && void onboard({ name }, 'create')}
            />
            {slug ? (
              <Text fontSize="$2" color="$color10">
                Identifier: <Text color="$color12">{slug}</Text>
              </Text>
            ) : (
              <Text fontSize="$2" color="$color10">
                Letters and numbers — spaces become hyphens.
              </Text>
            )}
          </YStack>

          {error ? (
            <Text fontSize="$2" color="$red10">
              {error}
            </Text>
          ) : null}

          <Button
            size="$4"
            theme="light"
            disabled={!canCreate}
            iconAfter={busy === 'create' ? <Spinner color="$color1" /> : <ArrowRight size={16} />}
            onPress={() => void onboard({ name }, 'create')}
          >
            {busy === 'create' ? 'Creating…' : 'Create organization'}
          </Button>

          <XStack items="center" gap="$3">
            <YStack flex={1} height={1} bg="$borderColor" />
            <Text fontSize="$1" color="$color10">
              OR
            </Text>
            <YStack flex={1} height={1} bg="$borderColor" />
          </XStack>

          <Button
            size="$3"
            disabled={!!busy}
            icon={busy === 'personal' ? <Spinner color="$color11" /> : <Sparkles size={16} />}
            onPress={() => void onboard({ personal: true }, 'personal')}
          >
            {busy === 'personal' ? 'Setting up…' : 'Skip — use a personal organization'}
          </Button>

          <Button size="$2" chromeless disabled={!!busy} onPress={() => void signOut()}>
            Sign out
          </Button>
        </Card>
      </FadeIn>
    </Center>
  )
}

const CENTER_STYLE = { display: 'flex', justifyContent: 'center', width: '100%' } as const

function Center({ children }: { children: ReactNode }) {
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" p="$4">
      {children}
    </YStack>
  )
}
