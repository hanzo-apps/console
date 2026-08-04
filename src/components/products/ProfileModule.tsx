'use client'

/**
 * Profile — the signed-in user's own account.
 *
 * Reads the REAL account from the session (`get-account`): identity, email, org,
 * and role. Identity mutations (name, password, 2FA) are owned by Hanzo IAM — this
 * deep-links there rather than re-implementing them (never a plaintext password
 * here). The API Keys tab embeds the shared per-user `sk-` credential surface.
 * Reached from the footer wallet's user row; also carries Sign out.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useRef, useState } from 'react'
import { Avatar, Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Camera, Check, Copy, ExternalLink, KeyRound, LogOut, ShieldCheck } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { AccountApi, ApiError } from '~/lib/api'
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

/**
 * The profile photo, and the control that changes it.
 *
 * The photo used to be read-only here — the card rendered `avatar` and offered
 * "Edit in IAM", which links to an IAM that has no way to set one either (its
 * only writers are federation and SCIM). So a password signup had a monogram and
 * no way out of it.
 *
 * DOWNSCALED IN THE BROWSER before upload. A phone original is several MB and
 * would be served to every viewer of every page that shows this face; 512px is
 * larger than any surface renders it. The server still caps the body — this is
 * the courtesy, not the guard. A source the canvas cannot decode is sent
 * verbatim rather than dropped, and the server's format check is the authority.
 */
const PHOTO_EDGE = 512

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // PNG keeps transparency and is on the server's allow-list. A canvas that
    // refuses to encode yields null — send the original rather than nothing.
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    return out ?? file
  } finally {
    bitmap.close()
  }
}

function PhotoCard() {
  const { account, reload } = useSession()
  const name = account?.displayName || account?.name || 'Account'
  const [photo, setPhoto] = useState<string | undefined>(
    typeof account?.avatar === 'string' ? account.avatar : undefined,
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      let body: File = file
      try {
        const small = await downscale(file)
        body = small === file ? file : new File([small], 'photo.png', { type: 'image/png' })
      } catch {
        /* undecodable here — let the server judge the original */
      }
      const url = await AccountApi.setAvatar(body)
      // Show the new photo immediately; the URL is content-addressed, so this can
      // never be a stale cache of the old one.
      setPhoto(url)
      // And re-read the session so every other surface in this tab agrees.
      void reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not update your photo.')
    } finally {
      setBusy(false)
      if (picker.current) picker.current.value = ''
    }
  }

  return (
    <YStack gap="$2">
      <XStack gap="$3" items="center">
        <Avatar circular size={56}>
          {photo ? <Avatar.Image accessibilityLabel={name} src={photo} /> : null}
          <Avatar.Fallback bg="$color5" items="center" justify="center">
            <Text fontSize="$5" fontWeight="800" color="$color12">{initials(name)}</Text>
          </Avatar.Fallback>
        </Avatar>
        <YStack flex={1}>
          <Text fontSize="$6" fontWeight="800" color="$color12">{name}</Text>
          <Text fontSize="$3" color="$color11">{account?.email || '—'}</Text>
        </YStack>
        <Button
          size="$2"
          disabled={busy}
          icon={busy ? <Spinner size="small" /> : <Camera size={15} />}
          onPress={() => picker.current?.click()}
        >
          {photo ? 'Change photo' : 'Add photo'}
        </Button>
      </XStack>
      {/* The file input is the real control; the Button is its label. Kept in the
          DOM (not display:none) so assistive tech can still reach it. */}
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label="Profile photo"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
    </YStack>
  )
}

function AccountTab() {
  const { account, signOut } = useSession()

  return (
    <YStack gap="$5">
      <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <XStack gap="$3" items="center">
          <YStack flex={1}>
            <PhotoCard />
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
