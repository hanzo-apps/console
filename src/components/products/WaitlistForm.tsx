'use client'

/**
 * WaitlistForm — the "Join waitlist" CTA for a coming-soon product.
 *
 * Posts the product slug + the user's email to the same-origin `/waitlist` proxy
 * (which forwards to the Hanzo Base waitlist backend). Email is prefilled from
 * the session. States are honest: a confirmed rank on success, "already on the
 * list" when the email was seen before, and a truthful message when the waitlist
 * isn't open on this deployment yet (the proxy 501s) — never a fake confirmation.
 */
import { useState } from 'react'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { CircleCheck, Mail } from '@hanzogui/lucide-icons-2'

import { useSession } from '~/lib/auth/session'

type JoinResponse = {
  ok?: boolean
  rank?: number
  total?: number
  alreadyJoined?: boolean
  error?: string
}

export function WaitlistForm({ waitlist, label }: { waitlist: string; label: string }) {
  const { account } = useSession()
  const [email, setEmail] = useState(account?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<JoinResponse | null>(null)

  const submit = async () => {
    const value = email.trim()
    if (!value) {
      setError('Enter your email.')
      return
    }
    setError(null)
    setBusy(true)
    let res: Response
    try {
      res = await fetch('/v1/waitlist', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlist, email: value }),
      })
    } catch {
      setError('Network error — please try again.')
      setBusy(false)
      return
    }
    const json = (await res.json().catch(() => null)) as JoinResponse | null
    if (!res.ok || !json?.ok) {
      setError(
        json?.error ||
          (res.status === 501
            ? `The ${label} waitlist isn’t open yet — check back soon.`
            : `Could not join the waitlist (HTTP ${res.status}).`),
      )
      setBusy(false)
      return
    }
    setJoined(json)
    setBusy(false)
  }

  if (joined) {
    return (
      <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color2" maxWidth={460}>
        <XStack gap="$2" items="center">
          <CircleCheck size={18} color="$green10" />
          <Text fontSize="$4" fontWeight="700" color="$color12">
            {joined.alreadyJoined ? 'You’re already on the list' : 'You’re on the waitlist'}
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          {typeof joined.rank === 'number'
            ? `You’re #${joined.rank}${typeof joined.total === 'number' ? ` of ${joined.total}` : ''} for ${label}. We’ll email you when it’s ready.`
            : `We’ll email you the moment ${label} is ready.`}
        </Text>
      </Card>
    )
  }

  return (
    <YStack gap="$2" maxW={460}>
      <XStack gap="$2" items="center" flexWrap="wrap">
        <XStack
          flex={1}
          minW={220}
          items="center"
          gap="$2"
          px="$3"
          height={44}
          rounded="$4"
          borderWidth={1}
          borderColor="$borderColor"
          bg="$color2"
        >
          <Mail size={16} opacity={0.6} />
          <Input
            flex={1}
            unstyled
            value={email}
            onChangeText={(v) => {
              setEmail(v)
              if (error) setError(null)
            }}
            placeholder="you@company.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onSubmitEditing={() => void submit()}
          />
        </XStack>
        <Button
          size="$4"
          theme="light"
          disabled={busy}
          icon={busy ? <Spinner color="$color1" /> : undefined}
          onPress={() => void submit()}
        >
          {busy ? 'Joining…' : 'Join waitlist'}
        </Button>
      </XStack>
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}
    </YStack>
  )
}
