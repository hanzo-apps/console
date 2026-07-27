'use client'

/**
 * Org onboarding — the first-run screen for a user who isn't in an organization.
 *
 * Shown by {@link OrgGate} when the session has no org. Two predictable paths:
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
import { slugifyOrg, validateOrgName } from '~/lib/server/onboarding'
import { v1Url } from '~/lib/api/client'
import { FadeIn } from '@hanzo/ui/product'

type Phase = 'form' | 'done'

export function OrgOnboarding() {
  const { signIn, signOut } = useSession()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<false | 'create' | 'personal'>(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('form')

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
      setError('Network error — please try again.')
      setBusy(false)
      return
    }
    const json = (await res.json().catch(() => null)) as { org?: string; error?: string } | null
    if (!res.ok || !json?.org) {
      setError(json?.error || `Could not create the organization (HTTP ${res.status}).`)
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
              Continue
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
