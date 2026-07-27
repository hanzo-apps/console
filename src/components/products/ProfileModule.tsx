'use client'

/**
 * Profile — the signed-in user's own account.
 *
 * Reads the REAL account from the session (`get-account`): identity, email, org,
 * and role. Identity mutations (name, password, 2FA) are owned by Hanzo IAM — this
 * deep-links there rather than re-implementing them (never a plaintext password
 * here). The API Keys tab embeds the shared per-user `hk-` credential surface.
 * Reached from the footer wallet's user row; also carries Sign out.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useState } from 'react'
import { Avatar, Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Copy, ExternalLink, KeyRound, LogOut, ShieldCheck } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { ApiError } from '~/lib/api'
import { MfaApi, type MfaSetup } from '~/lib/api/mfa'
import { PageHeader } from '~/components/ui/PageHeader'
import { FieldRow } from '~/components/ui/Field'
import { ApiKeysView } from './ApiKeysModule'

/** A labeled read-only value row; dim em-dash when empty. */
function InfoRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  const text = value === undefined || value === null || value === '' ? '—' : String(value)
  const empty = text === '—'
  return (
    <FieldRow label={label}>
      <Text fontSize="$3" color={empty ? '$color10' : '$color12'} pt="$2">{text}</Text>
    </FieldRow>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function ManageInIam({ label = 'Edit in IAM' }: { label?: string }) {
  return (
    <Button
      size="$2"
      icon={<ExternalLink size={15} />}
      onPress={() => { if (typeof window !== 'undefined') window.open(config.iamUrl, '_blank', 'noopener') }}
    >
      {label}
    </Button>
  )
}

function AccountTab() {
  const { account, signOut } = useSession()
  const name = account?.displayName || account?.name || 'Account'
  const avatar = typeof account?.avatar === 'string' ? account.avatar : undefined

  return (
    <YStack gap="$5">
      <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <XStack gap="$3" items="center">
          <Avatar circular size={56}>
            {avatar ? <Avatar.Image accessibilityLabel={name} src={avatar} /> : null}
            <Avatar.Fallback bg="$color5" items="center" justify="center">
              <Text fontSize="$5" fontWeight="800" color="$color12">{initials(name)}</Text>
            </Avatar.Fallback>
          </Avatar>
          <YStack flex={1}>
            <Text fontSize="$6" fontWeight="800" color="$color12">{name}</Text>
            <Text fontSize="$3" color="$color11">{account?.email || '—'}</Text>
          </YStack>
          <ManageInIam />
        </XStack>
        <YStack gap="$3.5">
          <InfoRow label="Username" value={account?.name} />
          <InfoRow label="Organization" value={account?.organization || account?.owner} />
          <InfoRow label="Role" value={account?.isAdmin ? 'Organization admin' : 'Member'} />
        </YStack>
      </Card>

      <XStack>
        <Button icon={<LogOut size={16} />} onPress={() => void signOut()}>Sign out</Button>
      </XStack>
    </YStack>
  )
}

/** Small copy-to-clipboard chip for the TOTP secret. */
function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="$2"
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      onPress={async () => {
        try {
          await navigator.clipboard?.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard blocked — value is visible */ }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

/** Two-factor (authenticator app / TOTP) — enrolled NATIVELY in the console over the
 *  user's own bearer, so it works regardless of the hanzo.id account-session path. */
function TwoFactorCard() {
  const { account } = useSession()
  // Best-effort initial state from the session claims (IAM sets a preferred type
  // when 2FA is on); the enroll/disable actions are authoritative thereafter.
  const claims = account as unknown as { preferredMfaType?: string; mfaEnabled?: boolean } | null
  const [enabled, setEnabled] = useState(Boolean(claims?.preferredMfaType || claims?.mfaEnabled))
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')

  const start = async () => {
    setBusy(true); setErr(null)
    try {
      setSetup(await MfaApi.initiate())
      setCode('')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const confirm = async () => {
    if (!setup) return
    setBusy(true); setErr(null)
    try {
      await MfaApi.verify(setup.secret, code.trim())
      await MfaApi.enable(setup.secret, setup.recoveryCode)
      setEnabled(true); setSetup(null); setCode('')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const disable = async () => {
    setBusy(true); setErr(null)
    try { await MfaApi.disable(); setEnabled(false); setSetup(null) } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack gap="$2" items="center" justify="space-between">
        <XStack gap="$2" items="center">
          <ShieldCheck size={18} />
          <Text fontSize="$5" fontWeight="700">Two-factor authentication</Text>
        </XStack>
        {enabled ? (
          <Text fontSize="$2" px="$2" py="$1" rounded="$2" bg="$green4" color="$green11">On</Text>
        ) : (
          <Text fontSize="$2" px="$2" py="$1" rounded="$2" bg="$color4" color="$color11">Off</Text>
        )}
      </XStack>

      {enabled ? (
        <>
          <Text fontSize="$3" color="$color11">
            An authenticator app is required at sign-in. You'll be asked for a 6-digit code after your password.
          </Text>
          <XStack>
            <Button theme="red" size="$3" disabled={busy} icon={busy ? <Spinner size="small" /> : undefined} onPress={() => void disable()}>
              Turn off two-factor
            </Button>
          </XStack>
        </>
      ) : setup ? (
        <YStack gap="$3">
          <Text fontSize="$3" color="$color11">
            Add this account to an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.
          </Text>
          <YStack gap="$1.5">
            <Text fontSize="$2" color="$color11" fontWeight="600">Setup key</Text>
            <XStack gap="$2" items="center">
              <Text flex={1} fontSize="$3" color="$color12" px="$2.5" py="$2" rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
                {setup.secret}
              </Text>
              <CopyChip value={setup.secret} />
            </XStack>
            {setup.url ? (
              <Text fontSize="$1" color="$color10" numberOfLines={1}>
                Or add via URI: {setup.url}
              </Text>
            ) : null}
          </YStack>
          <YStack gap="$1.5">
            <Text fontSize="$2" color="$color11" fontWeight="600">6-digit code</Text>
            <Input
              value={code}
              onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); if (err) setErr(null) }}
              placeholder="123456"
              keyboardType="number-pad"
              onSubmitEditing={() => void confirm()}
            />
          </YStack>
          {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
          <XStack gap="$2">
            <Button theme="light" disabled={busy || code.length !== 6} icon={busy ? <Spinner size="small" /> : <KeyRound size={16} />} onPress={() => void confirm()}>
              Verify &amp; turn on
            </Button>
            <Button chromeless disabled={busy} onPress={() => { setSetup(null); setErr(null) }}>Cancel</Button>
          </XStack>
        </YStack>
      ) : (
        <>
          <Text fontSize="$3" color="$color11">
            Add a second factor with an authenticator app. After your password, sign-in will ask for a 6-digit code —
            protecting your {config.brandName} account even if your password is compromised.
          </Text>
          {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
          <XStack>
            <Button theme="light" size="$3" disabled={busy} icon={busy ? <Spinner size="small" /> : <ShieldCheck size={16} />} onPress={() => void start()}>
              Set up authenticator app
            </Button>
          </XStack>
        </>
      )}
    </Card>
  )
}

function SecurityTab() {
  return (
    <YStack gap="$4" maxW={720}>
      <TwoFactorCard />
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$2" items="center">
          <KeyRound size={18} />
          <Text fontSize="$5" fontWeight="700">Password</Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Your password is managed by Hanzo IAM — never stored here. Change it in the identity console;
          it applies to every {config.brandName} product you sign in to.
        </Text>
        <XStack>
          <ManageInIam label="Change password in IAM" />
        </XStack>
      </Card>
    </YStack>
  )
}

export function ProfileModule({ params }: { params: Record<string, string> }) {
  const tab = productSubpageSlug('profile', params.tab)

  const body =
    tab === 'security' ? <SecurityTab /> : tab === 'keys' ? <ApiKeysView /> : <AccountTab />

  return (
    <>
      <PageHeader title="Profile" subtitle="Your account, security, and personal API keys." />
      <SubNav id="profile" />
      {body}
    </>
  )
}
