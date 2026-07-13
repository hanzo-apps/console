'use client'

/**
 * QR device sign-in (RFC 8628) — the "scan to sign in" section of the sign-in card.
 *
 * The console is the device: on mount it asks the BFF for a device authorization,
 * renders the approval URL as a QR (plus the short user code as text for a manual
 * fallback), and polls at the IAM-supplied cadence. The moment the user approves on
 * their phone, the poll succeeds — the BFF has already set the sealed session cookies —
 * so we reload the session and land on the console. The device_code never rides the QR
 * (only the user-facing approval URL does); it stays in memory and is redeemed poll-side.
 *
 * Rendered INSIDE the sign-in card's shell (the caller supplies the title), so this is
 * just the inner section + a "Use email instead" way back.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { Button, Spinner, Text, YStack } from '@hanzo/gui'

import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { useSession } from '~/lib/auth/session'
import { pollDeviceLogin, startDeviceLogin, type DeviceStart } from '~/lib/auth/iam-device'

type Phase = 'loading' | 'waiting' | 'expired' | 'error'

/** Hard cap on how long we poll if IAM sends no `expires_in` (belt to the code's own TTL). */
const MAX_LIFETIME_MS = 15 * 60 * 1000

export function QrSignIn({ onBack }: { onBack: () => void }) {
  const { reload } = useSession()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [start, setStart] = useState<DeviceStart | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Monotonic run id: every (re)start bumps it, so a stale async result or an interval
  // tick from a superseded/torn-down flow is ignored — no double-poll, no post-unmount
  // setState (survives React 18/19 StrictMode's double-mount cleanly).
  const runId = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const begin = useCallback(async () => {
    const run = ++runId.current
    stop()
    setPhase('loading')
    setError(null)
    setStart(null)

    let s: DeviceStart
    try {
      s = await startDeviceLogin()
    } catch (e) {
      if (run !== runId.current) return
      setError(e instanceof Error ? e.message : 'Could not start QR sign-in.')
      setPhase('error')
      return
    }
    if (run !== runId.current) return
    setStart(s)
    setPhase('waiting')

    const deadline = Date.now() + (s.expiresIn > 0 ? s.expiresIn * 1000 : MAX_LIFETIME_MS)
    timer.current = setInterval(async () => {
      if (run !== runId.current) return
      if (Date.now() > deadline) {
        stop()
        setPhase('expired')
        return
      }
      const r = await pollDeviceLogin(s.deviceCode)
      if (run !== runId.current) return
      if (r.status === 'ok') {
        runId.current++ // finalize: no further ticks or in-flight polls act
        stop()
        await reload()
        router.replace('/')
      } else if (r.status === 'expired') {
        stop()
        setPhase('expired')
      } else if (r.status === 'error') {
        stop()
        setError(r.message)
        setPhase('error')
      }
      // 'pending' → keep polling
    }, s.interval * 1000)
  }, [reload, router, stop])

  useEffect(() => {
    void begin()
    return () => {
      runId.current++ // invalidate any in-flight start/poll on unmount
      stop()
    }
  }, [begin, stop])

  if (phase === 'expired') {
    return (
      <YStack gap="$3" items="center">
        <Text fontSize="$5" fontWeight="700">
          Code expired
        </Text>
        <Text fontSize="$3" color="$color11" text="center">
          The sign-in code timed out before it was approved. Generate a new one to try again.
        </Text>
        <PrimaryButton size="$4" width="100%" onPress={() => void begin()}>
          New code
        </PrimaryButton>
        <Button size="$3" chromeless onPress={onBack}>
          Use email instead
        </Button>
      </YStack>
    )
  }

  if (phase === 'error') {
    return (
      <YStack gap="$3" items="center">
        <Text fontSize="$5" fontWeight="700">
          Couldn&apos;t start QR sign-in
        </Text>
        {error ? (
          <Text fontSize="$3" color="$red10" text="center" role="alert">
            {error}
          </Text>
        ) : null}
        <PrimaryButton size="$4" width="100%" onPress={() => void begin()}>
          Try again
        </PrimaryButton>
        <Button size="$3" chromeless onPress={onBack}>
          Use email instead
        </Button>
      </YStack>
    )
  }

  return (
    <YStack gap="$3" items="center">
      {/* QR always renders on a light tile so it scans in either console theme. */}
      <YStack bg="#ffffff" p="$3" rounded="$4" items="center" justify="center" width={232} height={232}>
        {start ? (
          <QRCodeSVG value={start.verificationUriComplete} size={200} level="M" bgColor="#ffffff" fgColor="#000000" />
        ) : (
          <Spinner size="large" color="$color8" />
        )}
      </YStack>

      <Text fontSize="$3" color="$color11" text="center">
        Scan with your phone&apos;s camera, then approve the sign-in.
      </Text>

      {start ? (
        <YStack items="center" gap="$1">
          <Text fontSize="$2" color="$color10">
            Or enter this code
          </Text>
          <Text fontSize="$8" fontWeight="800" letterSpacing={6}>
            {start.userCode}
          </Text>
        </YStack>
      ) : null}

      <Button size="$3" chromeless icon={<Spinner size="small" />} disabled>
        Waiting for approval…
      </Button>
      <Button size="$3" chromeless onPress={onBack}>
        Use email instead
      </Button>
    </YStack>
  )
}
