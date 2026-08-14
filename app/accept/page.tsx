'use client'

/**
 * /accept — the invitee's landing page for a team invite (PUBLIC, no session).
 *
 * The org admin shares this link (email/OTP delivery isn't wired on this
 * deployment). The invitee opens it, sees the org they've been invited to, sets a
 * password (IAM hashes it server-side — never plaintext), then signs in and lands
 * in that org with the role the admin assigned. Honest states throughout: an
 * invalid/expired link, an already-accepted link, and IAM errors are all truthful,
 * never a fake success.
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '~/lib/router'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { CheckCircle2, ArrowRight, ShieldAlert, UserPlus } from '@hanzogui/lucide-icons-2'

import { MIN_PASSWORD } from '~/lib/server/onboarding'

type Info =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'accepted'; org: string }
  | { phase: 'form'; org: string; email: string; displayName: string; role: string }

function Center({ children }: { children: React.ReactNode }) {
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" p="$4">
      {children}
    </YStack>
  )
}

function AcceptFlow() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params?.get('t') ?? ''

  const [info, setInfo] = useState<Info>({ phase: 'loading' })
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<false | string>(false)

  useEffect(() => {
    if (!token) {
      setInfo({ phase: 'error', message: 'This invitation link is missing its token.' })
      return
    }
    let live = true
    ;(async () => {
      let res: Response
      try {
        res = await fetch(`/console/accept?t=${encodeURIComponent(token)}`, { credentials: 'include' })
      } catch {
        if (live) setInfo({ phase: 'error', message: 'Network error — please try again.' })
        return
      }
      const j = (await res.json().catch(() => null)) as
        | { org?: string; email?: string; displayName?: string; role?: string; accepted?: boolean; error?: string }
        | null
      if (!live) return
      if (!res.ok || !j?.org) {
        setInfo({ phase: 'error', message: j?.error || 'This invitation link is invalid or has expired.' })
        return
      }
      if (j.accepted) {
        setInfo({ phase: 'accepted', org: j.org })
        return
      }
      setInfo({ phase: 'form', org: j.org, email: j.email || '', displayName: j.displayName || '', role: j.role || 'member' })
      setName(j.displayName || '')
    })()
    return () => {
      live = false
    }
  }, [token])

  const submit = useCallback(async () => {
    if (password.length < MIN_PASSWORD) {
      setErr(`Use a password of at least ${MIN_PASSWORD} characters.`)
      return
    }
    setBusy(true)
    setErr(null)
    let res: Response
    try {
      res = await fetch('/console/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, password, displayName: name.trim() || undefined }),
      })
    } catch {
      setErr('Network error — please try again.')
      setBusy(false)
      return
    }
    const j = (await res.json().catch(() => null)) as { ok?: boolean; org?: string; error?: string } | null
    if (!res.ok || !j?.ok) {
      setErr(j?.error || `Could not activate your account (HTTP ${res.status}).`)
      setBusy(false)
      return
    }
    setDone(j.org || (info.phase === 'form' ? info.org : ''))
  }, [password, name, token, info])

  if (done !== false) {
    return (
      <Center>
        <Card p="$5" gap="$4" width={440} maxW="92vw" borderWidth={1} borderColor="$borderColor" bg="$color1" items="center">
          <CheckCircle2 size={40} color="$green10" />
          <YStack gap="$1" items="center">
            <Text fontSize="$7" fontWeight="800">You're in</Text>
            <Text fontSize="$3" color="$color11" text="center">
              Your account for <Text color="$color12" fontWeight="700">{done}</Text> is ready. Sign in to continue.
            </Text>
          </YStack>
          <Button
            size="$4"
            theme="light"
            width="100%"
            iconAfter={<ArrowRight size={16} />}
            onPress={() => router.push('/signin')}
          >
            Sign in
          </Button>
        </Card>
      </Center>
    )
  }

  if (info.phase === 'loading') {
    return (
      <Center>
        <Spinner size="large" color="$color11" />
      </Center>
    )
  }

  if (info.phase === 'error') {
    return (
      <Center>
        <Card p="$5" gap="$3" width={440} maxW="92vw" borderWidth={1} borderColor="$borderColor" bg="$color1" items="center">
          <ShieldAlert size={36} color="$red10" />
          <Text fontSize="$6" fontWeight="800">Invitation unavailable</Text>
          <Text fontSize="$3" color="$color11" text="center">{info.message}</Text>
          <Button size="$3" onPress={() => router.push('/signin')}>Go to sign in</Button>
        </Card>
      </Center>
    )
  }

  if (info.phase === 'accepted') {
    return (
      <Center>
        <Card p="$5" gap="$3" width={440} maxW="92vw" borderWidth={1} borderColor="$borderColor" bg="$color1" items="center">
          <CheckCircle2 size={36} color="$green10" />
          <Text fontSize="$6" fontWeight="800">Already accepted</Text>
          <Text fontSize="$3" color="$color11" text="center">
            This invitation to <Text color="$color12" fontWeight="700">{info.org}</Text> was already used. Sign in to continue.
          </Text>
          <Button size="$4" theme="light" iconAfter={<ArrowRight size={16} />} onPress={() => router.push('/signin')}>
            Sign in
          </Button>
        </Card>
      </Center>
    )
  }

  return (
    <Center>
      <Card p="$5" gap="$4" width={440} maxW="92vw" borderWidth={1} borderColor="$borderColor" bg="$color1">
        <YStack gap="$2">
          <XStack gap="$2" items="center">
            <UserPlus size={20} />
            <Text fontSize="$7" fontWeight="800">Join {info.org}</Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            You've been invited to <Text color="$color12" fontWeight="700">{info.org}</Text> as a{' '}
            <Text color="$color12" fontWeight="700">{info.role}</Text>. Set a password to activate{' '}
            <Text color="$color12">{info.email}</Text> and sign in.
          </Text>
        </YStack>

        <YStack gap="$2">
          <Text fontSize="$2" color="$color11" fontWeight="600">Your name</Text>
          <Input value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
        </YStack>

        <YStack gap="$2">
          <Text fontSize="$2" color="$color11" fontWeight="600">Password</Text>
          <Input
            value={password}
            onChangeText={(v) => {
              setPassword(v)
              if (err) setErr(null)
            }}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            // secureTextEntry alone does not mask in this @hanzo/gui build; set the
            // web input type explicitly (RNW passthrough) — same as SignInForm.
            secureTextEntry
            {...{ type: 'password' }}
            autoComplete="new-password"
            onSubmitEditing={() => void submit()}
          />
        </YStack>

        {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}

        <Button
          size="$4"
          theme="light"
          disabled={busy || password.length < MIN_PASSWORD}
          iconAfter={busy ? <Spinner color="$color1" /> : <ArrowRight size={16} />}
          onPress={() => void submit()}
        >
          {busy ? 'Activating…' : 'Set password & join'}
        </Button>
      </Card>
    </Center>
  )
}

export default function AcceptPage() {
  return (
    <Suspense fallback={<Center><Spinner size="large" color="$color11" /></Center>}>
      <AcceptFlow />
    </Suspense>
  )
}
