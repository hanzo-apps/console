'use client'

/**
 * AI Accounts — connect/link screen. The AI providers (from the shared catalog,
 * mirroring the `@hanzo/usage` registry) each get an inline connect form: pick a
 * link mode (API key / OAuth token / cookie header), paste the credential, save.
 * The secret is POSTed to `/v1/ai-accounts/accounts/:id`, sealed server-side, and
 * NEVER stored in the browser (no localStorage) or echoed back. The non-AI groups
 * are honest, catalog-driven "coming soon" rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Trash2, Plus } from '@hanzogui/lucide-icons-2'

import { trackedProviderIds } from '@hanzo/usage'

import { AiAccountsApi, type PublicAccount } from '~/lib/api/ai-accounts'
import { AI_PROVIDERS, COMING_SOON, MODE_LABEL, type AiProvider, type ConnectMode } from '~/lib/products/ai-accounts'
import { PageHeader } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { FieldRow, FieldText, FieldSelect } from '@hanzo/ui/product'
import { Loader } from '~/components/ui/Loader'
import { useToast } from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const modeFromLabel = (label: string): ConnectMode =>
  (Object.keys(MODE_LABEL) as ConnectMode[]).find((m) => MODE_LABEL[m] === label) ?? 'api'

/** Provider ids with a live `@hanzo/usage` pipeline (vs. connect-only). */
const TRACKED = new Set<string>(trackedProviderIds)

/** The connect form + connected-state for one AI provider. */
function ProviderRow({
  provider,
  connected,
  onChanged,
}: {
  provider: AiProvider
  connected?: PublicAccount
  onChanged: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ConnectMode>(provider.modes[0])
  const [secret, setSecret] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setSecret('')
    setBaseUrl('')
    setOpen(false)
  }

  const save = async () => {
    if (!secret.trim()) return
    setBusy(true)
    try {
      await AiAccountsApi.connect(provider.id, { mode, secret, baseUrl: baseUrl.trim() || undefined })
      toast.success(`Connected ${provider.label}`)
      reset()
      onChanged()
    } catch (e) {
      toast.error('Could not connect', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await AiAccountsApi.disconnect(provider.id)
      toast.success(`Disconnected ${provider.label}`)
      onChanged()
    } catch (e) {
      toast.error('Could not disconnect', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$3" justify="space-between" flexWrap="wrap">
        <XStack items="center" gap="$3" flex={1} minW={0}>
          <YStack width={10} height={10} rounded={99} style={{ backgroundColor: provider.color }} />
          <YStack minW={0}>
            <XStack items="center" gap="$2" flexWrap="wrap">
              <Text fontSize="$5" fontWeight="700">
                {provider.label}
              </Text>
              <XStack px="$2" py="$0.5" rounded="$2" borderWidth={1} borderColor="$borderColor" bg="$color2">
                <Text fontSize="$1" color={TRACKED.has(provider.id) ? '#3fb950' : '$color10'}>
                  {TRACKED.has(provider.id) ? 'In-app tracked' : 'Connect-only'}
                </Text>
              </XStack>
            </XStack>
            <Text fontSize="$2" color="$color10">
              {provider.vendor}
            </Text>
          </YStack>
        </XStack>

        {provider.native ? (
          <XStack items="center" gap="$2">
            <Check size={15} color="#3fb950" />
            <Text fontSize="$2" color="$color11">
              Connected · this org
            </Text>
          </XStack>
        ) : connected ? (
          <XStack items="center" gap="$2" flexWrap="wrap">
            <Check size={15} color="#3fb950" />
            <Text fontSize="$2" color="$color11">
              {MODE_LABEL[connected.mode]} linked
            </Text>
            <Button size="$2" icon={<Trash2 size={14} />} disabled={busy} onPress={disconnect}>
              Disconnect
            </Button>
            <Button size="$2" onPress={() => setOpen((v) => !v)}>
              Update
            </Button>
          </XStack>
        ) : (
          <Button size="$2" theme="light" icon={<Plus size={14} />} onPress={() => setOpen((v) => !v)}>
            Connect
          </Button>
        )}
      </XStack>

      {open && !provider.native ? (
        <YStack gap="$3" pt="$2" borderTopWidth={1} borderColor="$borderColor">
          <FieldRow label="Link with">
            <FieldSelect
              value={MODE_LABEL[mode]}
              options={provider.modes.map((m) => MODE_LABEL[m])}
              onChange={(v) => setMode(modeFromLabel(v))}
            />
          </FieldRow>
          <FieldRow label={MODE_LABEL[mode]}>
            <FieldText value={secret} onChange={setSecret} secure placeholder={`Paste your ${MODE_LABEL[mode].toLowerCase()}`} />
          </FieldRow>
          <FieldRow label="Base URL">
            <FieldText value={baseUrl} onChange={setBaseUrl} placeholder="Optional — self-hosted gateway" />
          </FieldRow>
          <XStack gap="$2" justify="flex-end">
            <Button size="$2" disabled={busy} onPress={reset}>
              Cancel
            </Button>
            <Button size="$2" theme="light" disabled={busy || !secret.trim()} onPress={save}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </XStack>
          <Text fontSize="$1" color="$color10">
            Your credential is encrypted server-side and never stored in the browser.
          </Text>
        </YStack>
      ) : null}
    </Card>
  )
}

export function AIAccountsAccounts(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<PublicAccount[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    AiAccountsApi.list()
      .then((r) => setState({ phase: 'ready', data: r.providers }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const connected = (id: string): PublicAccount | undefined =>
    state.phase === 'ready' ? state.data.find((a) => a.id === id) : undefined

  return (
    <>
      <PageHeader title="Accounts" subtitle="Link your AI provider accounts. More integrations are on the way." />

      {state.phase === 'loading' ? (
        <Loader label="Loading accounts…" />
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} />
      ) : (
        <YStack gap="$5">
          <YStack gap="$3">
            <Text fontSize="$3" fontWeight="600" color="$color11">
              AI providers
            </Text>
            {AI_PROVIDERS.map((p) => (
              <ProviderRow key={p.id} provider={p} connected={connected(p.id)} onChanged={load} />
            ))}
          </YStack>

          {COMING_SOON.map((g) => (
            <YStack key={g.group} gap="$3">
              <Text fontSize="$3" fontWeight="600" color="$color11">
                {g.group}
              </Text>
              <Card p="$4" borderWidth={1} borderColor="$borderColor" borderStyle="dashed">
                <XStack gap="$2" flexWrap="wrap" items="center">
                  {g.items.map((name) => (
                    <XStack key={name} px="$3" py="$1.5" rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
                      <Text fontSize="$2" color="$color11">
                        {name}
                      </Text>
                    </XStack>
                  ))}
                  <Text fontSize="$1" color="$color10">
                    Coming soon
                  </Text>
                </XStack>
              </Card>
            </YStack>
          ))}
        </YStack>
      )}
    </>
  )
}
