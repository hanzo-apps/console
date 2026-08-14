'use client'

/**
 * Connections — the customer face of the KMS-backed AI Login Manager. An org links its
 * OWN OpenAI / Anthropic / Google account (paste an API key, or sign in via OAuth) so
 * Hanzo can serve those models on the org's own account AND import its third-party spend
 * into the unified Usage board.
 *
 * ONE connect path: this is thin UI over the EXISTING `AiConnectionsApi` (→
 * `/v1/ai/connections`, ai#79/#80). The key is POSTed to OUR origin over HTTPS and sealed
 * to Hanzo KMS server-side — NEVER persisted in the browser, never echoed back; reads
 * return only existence + a masked account label. No second key store, no re-implemented
 * KMS. Honest states throughout: loading, connected, not-connected, and a clear
 * "not configured" when a provider's OAuth app isn't provisioned on this deployment.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Check, ExternalLink, KeyRound, RefreshCw, Trash2 } from '@hanzogui/lucide-icons-2'

import { Loader } from '~/components/ui/Loader'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { useToast } from '~/components/ui/Toast'
import { ApiError } from '~/lib/api/client'
import { AiConnectionsApi, AI_CONNECTION_PROVIDERS, type AiConnection, type AiConnectionProvider } from '~/lib/api/ai-connections'
import { toneColor } from '~/components/ui/tone'
import { BackendStateCard, FieldText, PageHeader, PrimaryButton, SecretInput, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Phase = { t: 'loading' } | { t: 'ready' } | { t: 'error'; state: BackendState }

/** Consume the OAuth callback's `?ai_connected` / `?ai_connect_error` query params (the
 *  backend redirects the browser back to the console after a provider login), returning a
 *  toast to show and stripping them from the URL so a refresh doesn't re-toast. */
function takeOAuthResult(): { ok?: string; err?: string; reason?: string } | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search)
  const ok = p.get('ai_connected') ?? undefined
  const err = p.get('ai_connect_error') ?? undefined
  if (!ok && !err) return null
  const reason = p.get('reason') ?? undefined
  p.delete('ai_connected')
  p.delete('ai_connect_error')
  p.delete('reason')
  const qs = p.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  return { ok, err, reason }
}

function ProviderCard({
  meta,
  connection,
  busy,
  onConnect,
  onOAuth,
  onDisconnect,
}: {
  meta: (typeof AI_CONNECTION_PROVIDERS)[number]
  connection: AiConnection | undefined
  busy: boolean
  onConnect: (key: string) => void
  onOAuth: () => void
  onDisconnect: () => void
}) {
  const [key, setKey] = useState('')
  const connected = connection?.connected === true

  return (
    <YStack gap="$3" p="$4" borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1" flex={1} minW={320}>
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$3" flex={1}>
          <ProviderLogo provider={meta.label} size={28} />
          <YStack gap="$0.5" flex={1}>
            <Text fontSize="$5" fontWeight="700" color="$color12">
              {meta.label}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {meta.vendor}
            </Text>
          </YStack>
        </XStack>
        {connected ? (
          <XStack items="center" gap="$1.5">
            <Check size={15} color={toneColor('positive')} />
            <Text fontSize="$2" fontWeight="700" color={toneColor('positive')}>
              Connected
            </Text>
          </XStack>
        ) : (
          <Text fontSize="$2" color="$color10">
            Not connected
          </Text>
        )}
      </XStack>

      {connected ? (
        <YStack gap="$3">
          {connection?.accountLabel ? (
            <Text fontSize="$2" color="$color11" numberOfLines={1}>
              {connection.accountLabel}
            </Text>
          ) : null}
          <Text fontSize="$1" color="$color10">
            Serving on your {meta.label} account. Usage imports into AI Metrics.
          </Text>
          <XStack>
            <Button size="$2" icon={<Trash2 size={14} />} onPress={onDisconnect} disabled={busy}>
              Disconnect
            </Button>
          </XStack>
        </YStack>
      ) : (
        <YStack gap="$2">
          <SecretInput value={key} onChange={setKey} placeholder={meta.keyHint} disabled={busy} id={meta.id} />
          <XStack gap="$2" flexWrap="wrap">
            <PrimaryButton icon={<KeyRound size={15} />} onPress={() => onConnect(key)} disabled={busy || key.trim() === ''}>
              Connect
            </PrimaryButton>
            <Button size="$3" icon={<ExternalLink size={15} />} onPress={onOAuth} disabled={busy}>
              Sign in with {meta.label}
            </Button>
          </XStack>
        </YStack>
      )}
    </YStack>
  )
}

export function ConnectionsModule(_props: { params: Record<string, string> }) {
  const [phase, setPhase] = useState<Phase>({ t: 'loading' })
  const [rows, setRows] = useState<AiConnection[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(() => {
    setPhase({ t: 'loading' })
    AiConnectionsApi.list()
      .then((r) => {
        setRows(r)
        setPhase({ t: 'ready' })
      })
      .catch((e) => setPhase({ t: 'error', state: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    const oauth = takeOAuthResult()
    if (oauth?.ok) toast.success(`Connected ${oauth.ok}`, 'Your account is linked. Usage will import into AI Metrics.')
    if (oauth?.err) toast.error(`Could not connect ${oauth.err}`, oauth.reason || 'The provider login did not complete.')
    load()
  }, [load, toast])

  const connect = useCallback(
    (provider: AiConnectionProvider, key: string) => {
      if (key.trim() === '') return
      setBusy(provider)
      AiConnectionsApi.connect(provider, key.trim())
        .then(() => {
          toast.success(`Connected ${provider}`, 'Your key is sealed to Hanzo KMS — never stored in the browser.')
          load()
        })
        .catch((e) => toast.error('Could not connect', e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(null))
    },
    [load, toast],
  )

  const oauth = useCallback(
    (provider: AiConnectionProvider) => {
      setBusy(provider)
      AiConnectionsApi.authorizeUrl(provider)
        .then((url) => {
          window.location.href = url
        })
        .catch((e) => {
          const notConfigured = e instanceof ApiError && e.status === 503
          toast.error(
            notConfigured ? `${provider} login is not available` : `Could not start the ${provider} sign-in`,
            notConfigured ? 'This deployment has no OAuth app for this provider — paste an API key instead.' : e instanceof Error ? e.message : String(e),
          )
          setBusy(null)
        })
    },
    [toast],
  )

  const disconnect = useCallback(
    (provider: AiConnectionProvider) => {
      setBusy(provider)
      AiConnectionsApi.disconnect(provider)
        .then(() => {
          toast.success(`Disconnected ${provider}`, 'The org reverts to Hanzo-served models.')
          load()
        })
        .catch((e) => toast.error('Could not disconnect', e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(null))
    },
    [load, toast],
  )

  const byProvider = (id: string): AiConnection | undefined => rows.find((r) => r.provider === id)

  return (
    <YStack gap="$5">
      <PageHeader
        title="Connections"
        subtitle="Link your OpenAI, Anthropic, or Google account to serve models on your own account and import your spend into the unified Usage board."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {phase.t === 'loading' ? (
        <Loader label="Loading connections…" />
      ) : phase.t === 'error' ? (
        <BackendStateCard state={phase.state} hint="GET /v1/ai/connections" onRetry={load} />
      ) : (
        <YStack gap="$4">
          <XStack flexWrap="wrap" gap="$4">
            {AI_CONNECTION_PROVIDERS.map((meta) => (
              <ProviderCard
                key={meta.id}
                meta={meta}
                connection={byProvider(meta.id)}
                busy={busy === meta.id}
                onConnect={(key) => connect(meta.id, key)}
                onOAuth={() => oauth(meta.id)}
                onDisconnect={() => disconnect(meta.id)}
              />
            ))}
          </XStack>
          <Text fontSize="$1" color="$color10">
            Keys are sealed to Hanzo KMS on our servers (fail-closed) and never stored in the browser, returned, or logged. Disconnecting reverts the org to Hanzo-served models.
          </Text>
        </YStack>
      )}
    </YStack>
  )
}

