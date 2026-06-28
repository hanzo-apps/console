'use client'

/**
 * API Keys — the cloud/gateway API credential for the signed-in account.
 *
 * Replaces hanzoai/console's project/org "API Keys" settings (Prisma-backed in
 * the Langfuse fork) with the REAL credential the casibase backend issues on the
 * account: `accessKey` / `accessSecret`, read from the session `get-account`.
 * Secrets are masked by default and only revealed on explicit click (never
 * printed otherwise); if the backend doesn't expose key material to the browser
 * on this deployment, an honest state explains where keys are managed — nothing
 * is ever fabricated.
 *
 * `ApiKeysView` is the bare surface so the Settings module can embed it as a tab;
 * `ApiKeysModule` wraps it with the page header for the standalone Dev route.
 */
import { useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Eye, EyeOff, Copy, Check, ExternalLink } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { PageHeader } from '~/components/ui/PageHeader'
import { FieldRow } from '~/components/ui/Field'
import { ErrorState } from '~/components/ui/States'

const DOCS_API = 'https://docs.hanzo.ai/api'

/** Mask a secret, keeping a short prefix/suffix for recognizability. */
function mask(v: string): string {
  if (v.length <= 12) return '•'.repeat(Math.max(v.length, 8))
  return `${v.slice(0, 6)}${'•'.repeat(8)}${v.slice(-4)}`
}

/** A masked credential row with reveal + copy. The value is the secret material. */
function SecretRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (no permission / insecure context) — reveal instead.
      setShown(true)
    }
  }

  return (
    <FieldRow label={label}>
      <YStack gap="$1.5">
        <XStack gap="$2" items="center" flexWrap="wrap">
          <Text fontSize="$3" color="$color12" flex={1}>
            {shown ? value : mask(value)}
          </Text>
          <Button
            size="$2"
            icon={shown ? <EyeOff size={14} /> : <Eye size={14} />}
            onPress={() => setShown((s) => !s)}
          >
            {shown ? 'Hide' : 'Reveal'}
          </Button>
          <Button
            size="$2"
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            onPress={() => void copy()}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </XStack>
        {hint ? (
          <Text fontSize="$2" color="$color10">
            {hint}
          </Text>
        ) : null}
      </YStack>
    </FieldRow>
  )
}

/** The credential surface — embeddable (no page header). */
export function ApiKeysView() {
  const { account, loading } = useSession()

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (!account) {
    return <ErrorState err={new ApiError('Not authorized', 401)} />
  }

  const rec = account as unknown as Record<string, unknown>
  const accessKey = typeof rec.accessKey === 'string' ? rec.accessKey : ''
  const accessSecret = typeof rec.accessSecret === 'string' ? rec.accessSecret : ''

  if (!accessKey && !accessSecret) {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
        <Text fontSize="$4" fontWeight="700">
          No API key on this account
        </Text>
        <Text fontSize="$3" color="$color11">
          This deployment does not expose API key material to the browser. Cloud
          and gateway keys are issued, scoped, and rotated through the API
          gateway — generate one there, then use it with the SDKs and CLI.
        </Text>
        <Button
          size="$2"
          self="flex-start"
          icon={<ExternalLink size={15} />}
          onPress={() => {
            if (typeof window !== 'undefined') window.open(DOCS_API, '_blank', 'noopener')
          }}
        >
          API docs
        </Button>
      </Card>
    )
  }

  return (
    <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
      {accessKey ? (
        <SecretRow
          label="Access key"
          value={accessKey}
          hint="Public identifier for your cloud API requests."
        />
      ) : null}
      {accessSecret ? (
        <SecretRow
          label="Access secret"
          value={accessSecret}
          hint="Treat this like a password. Anyone with it can call the API as you — rotate it in IAM if exposed."
        />
      ) : null}
    </Card>
  )
}

export function ApiKeysModule(_props: { params: Record<string, string> }) {
  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle="The cloud API credential for your account. Use it with the SDKs, CLI, and gateway."
      />
      <ApiKeysView />
    </>
  )
}
