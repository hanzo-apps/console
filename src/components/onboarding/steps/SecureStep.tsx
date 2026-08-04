'use client'

/**
 * Step 1 — Secure your account (2FA). REAL: enrolls TOTP over the console's own
 * `/console/mfa/*` BFF (→ IAM `mfa/setup/{initiate,verify,enable}`), the same path
 * Profile → Security uses. Skippable ("Skip securing my account"). If 2FA is already
 * on (session claims), it just confirms and lets the user continue.
 */
import { useState } from 'react'
import { Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ShieldCheck, KeyRound, Copy } from '@hanzogui/lucide-icons-2'

import { useSession } from '~/lib/auth/session'
import { ApiError } from '~/lib/api/client'
import { MfaApi, type MfaSetup } from '~/lib/api/mfa'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { StepShell, StepActions } from '~/components/onboarding/parts'
import type { StepProps } from '~/components/onboarding/types'

function copy(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(value).catch(() => {})
}

export function SecureStep({ next, skip, back, isFirst }: StepProps) {
  const { account } = useSession()
  const claims = account as unknown as { preferredMfaType?: string; mfaEnabled?: boolean } | null
  const [enabled, setEnabled] = useState(Boolean(claims?.preferredMfaType || claims?.mfaEnabled))
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')

  const start = async () => {
    setBusy(true)
    setErr(null)
    try {
      setSetup(await MfaApi.initiate())
      setCode('')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!setup) return
    setBusy(true)
    setErr(null)
    try {
      await MfaApi.verify(setup.secret, code.trim())
      await MfaApi.enable(setup.secret, setup.recoveryCode)
      setEnabled(true)
      setSetup(null)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell
      title="Secure your account"
      subtitle="Add two-factor authentication so a stolen password isn't enough to sign in."
      actions={
        <StepActions
          onBack={isFirst ? undefined : back}
          onSkip={enabled ? undefined : skip}
          skipLabel="Skip securing my account"
          onContinue={next}
          continueLabel="Continue"
          continueDisabled={!enabled}
          busy={busy}
        />
      }
    >
      {enabled ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$green7" bg="$green2">
          <XStack gap="$2" items="center">
            <ShieldCheck size={20} color="var(--green11)" />
            <Text fontSize="$5" fontWeight="700" color="$green11">
              Two-factor is on
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            You'll be asked for a 6-digit code after your password. You can manage it anytime in Profile → Security.
          </Text>
        </Card>
      ) : setup ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$3" color="$color11">
            Add this account to an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.
          </Text>
          <YStack gap="$1.5">
            <Text fontSize="$2" color="$color11" fontWeight="600">
              Setup key
            </Text>
            <XStack gap="$2" items="center">
              <Text
                flex={1}
                fontSize="$3"
                color="$color12"
                px="$2.5"
                py="$2"
                rounded="$3"
                borderWidth={1}
                borderColor="$borderColor"
                bg="$color2"
              >
                {setup.secret}
              </Text>
              <PrimaryButton size="$3" icon={<Copy size={15} />} onPress={() => copy(setup.secret)}>
                Copy
              </PrimaryButton>
            </XStack>
          </YStack>
          <YStack gap="$1.5">
            <Text fontSize="$2" color="$color11" fontWeight="600">
              6-digit code
            </Text>
            <Input
              value={code}
              onChangeText={(v) => {
                setCode(v.replace(/\D/g, '').slice(0, 6))
                if (err) setErr(null)
              }}
              placeholder="123456"
              keyboardType="number-pad"
              onSubmitEditing={() => void confirm()}
            />
          </YStack>
          {err ? (
            <Text fontSize="$2" color="$red10">
              {err}
            </Text>
          ) : null}
          <XStack gap="$2" items="center">
            <PrimaryButton
              size="$3"
              disabled={busy || code.length !== 6}
              icon={busy ? <Spinner size="small" color="$color1" /> : <KeyRound size={16} />}
              onPress={() => void confirm()}
            >
              Verify &amp; turn on
            </PrimaryButton>
          </XStack>
        </Card>
      ) : (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack gap="$3" items="center">
            <YStack width={40} height={40} rounded="$4" items="center" justify="center" bg="$color3">
              <ShieldCheck size={20} />
            </YStack>
            <YStack flex={1} minW={0} gap="$1">
              <Text fontSize="$5" fontWeight="700" color="$color12">
                Authenticator app
              </Text>
              <Text fontSize="$3" color="$color11">
                Time-based one-time codes (TOTP). Takes about a minute to set up.
              </Text>
            </YStack>
          </XStack>
          {err ? (
            <Text fontSize="$2" color="$red10">
              {err}
            </Text>
          ) : null}
          <XStack>
            <PrimaryButton size="$3" disabled={busy} icon={busy ? <Spinner size="small" color="$color1" /> : <ShieldCheck size={16} />} onPress={() => void start()}>
              Set up two-factor
            </PrimaryButton>
          </XStack>
        </Card>
      )}
    </StepShell>
  )
}
