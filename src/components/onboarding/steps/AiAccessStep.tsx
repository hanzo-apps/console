'use client'

/**
 * Step 5 — AI access. Three ways to power AI, user picks one (or more):
 *  (c) Let Hanzo power it — the native router serves the optimal model (up to 90%
 *      cheaper), paid from the payment method / trial credits. REAL: enables smart
 *      routing via `AiAccountsApi.saveSettings`.
 *  (b) Bring your own API keys — paste an OpenAI/Anthropic/Google key; stored KMS-
 *      sealed server-side (never plaintext). REAL: `AiConnectionsApi.connect` →
 *      `/v1/ai/connections`.
 *  (a) Connect a provider login (OAuth) — a real 3-legged OAuth to sign into your
 *      ChatGPT/Claude/Gemini account. REAL: `AiConnectionsApi.authorizeUrl` →
 *      `GET /v1/ai/connections/:provider/authorize` (ai#85); we redirect the browser
 *      to the provider consent screen and the backend seals the token KMS-side on the
 *      callback. Honest gap: a provider whose OAuth app creds aren't provisioned on
 *      this deployment returns 503 → shown as "not available", never a fake connection.
 *
 * All optional; Continue advances. Choices are recorded on the onboarding state.
 */
import { useEffect, useState } from 'react'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Wand2, KeyRound, LogIn, Check, Plus } from '@hanzogui/lucide-icons-2'

import { AiAccountsApi } from '~/lib/api/ai-accounts'
import { AiConnectionsApi, AI_CONNECTION_PROVIDERS, type AiConnection, type AiConnectionProvider } from '~/lib/api/ai-connections'
import { ApiError } from '~/lib/api/client'
import { useToast } from '~/components/ui/Toast'
import { ChoiceCard, StepShell, StepActions } from '~/components/onboarding/parts'
import { withAiChoice, type AiChoice } from '~/lib/onboarding/steps'
import type { StepProps } from '~/components/onboarding/types'
import { FieldSelect, FieldText, PrimaryButton } from '@hanzo/ui/product'

const providerLabel = (id: AiConnectionProvider): string => AI_CONNECTION_PROVIDERS.find((p) => p.id === id)?.label ?? id
const providerFromLabel = (label: string): AiConnectionProvider =>
  AI_CONNECTION_PROVIDERS.find((p) => p.label === label)?.id ?? 'openai'

export function AiAccessStep({ state, patch, next, skip, back, isFirst }: StepProps) {
  const toast = useToast()
  const [routing, setRouting] = useState(false)
  const [routingBusy, setRoutingBusy] = useState(false)
  const [byoOpen, setByoOpen] = useState(false)
  const [provider, setProvider] = useState<AiConnectionProvider>('openai')
  const [apiKey, setApiKey] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connections, setConnections] = useState<AiConnection[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [oauthOpen, setOauthOpen] = useState(false)
  const [oauthProvider, setOauthProvider] = useState<AiConnectionProvider>('openai')
  const [oauthBusy, setOauthBusy] = useState(false)
  // Providers whose OAuth app creds aren't provisioned on this deployment (backend 503).
  const [oauthUnavailable, setOauthUnavailable] = useState<AiConnectionProvider[]>([])

  const record = (choice: AiChoice) => patch({ aiChoices: withAiChoice(state, choice).aiChoices })

  useEffect(() => {
    let live = true
    void AiAccountsApi.settings()
      .then((s) => live && setRouting(s.settings.routingEnabled === true))
      .catch(() => {})
    void AiConnectionsApi.list()
      .then((c) => live && setConnections(c.filter((x) => x.connected)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const enableRouter = async () => {
    setRoutingBusy(true)
    setErr(null)
    try {
      await AiAccountsApi.saveSettings({ routingEnabled: true })
      setRouting(true)
      record('router')
      toast.success('Hanzo router enabled', 'Optimal model per request')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not enable smart routing.')
    } finally {
      setRoutingBusy(false)
    }
  }

  const connect = async () => {
    if (!apiKey.trim()) return
    setConnecting(true)
    setErr(null)
    try {
      await AiConnectionsApi.connect(provider, apiKey.trim())
      const list = await AiConnectionsApi.list().catch(() => connections)
      setConnections(list.filter((x) => x.connected))
      setApiKey('')
      record('byo')
      toast.success(`${providerLabel(provider)} connected`, 'Key stored securely')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not connect. Check the key and try again.')
    } finally {
      setConnecting(false)
    }
  }

  const startOauth = async () => {
    setOauthBusy(true)
    setErr(null)
    try {
      const authorizeUrl = await AiConnectionsApi.authorizeUrl(oauthProvider)
      record('connect')
      // Navigate to the provider consent screen; the backend callback links the
      // account and returns the user here. We're leaving the page, so leave busy set.
      window.location.assign(authorizeUrl)
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setOauthUnavailable((s) => (s.includes(oauthProvider) ? s : [...s, oauthProvider]))
      } else {
        setErr(e instanceof ApiError ? e.message : `Could not start ${providerLabel(oauthProvider)} sign-in. Try again.`)
      }
      setOauthBusy(false)
    }
  }

  const connectedLabels = connections.map((c) => c.provider).join(', ')

  return (
    <StepShell
      title="AI access"
      subtitle="Choose how you want to power AI. You can change or combine these anytime in AI Accounts."
      actions={
        <StepActions
          onBack={isFirst ? undefined : back}
          onSkip={skip}
          skipLabel="Decide later"
          onContinue={next}
          continueLabel="Continue"
        />
      }
    >
      <ChoiceCard
        icon={<Wand2 size={20} />}
        title="Let Hanzo power it"
        description="Our native router picks the optimal model for every request — up to 90% cheaper — billed to your credits."
        badge="Recommended"
        selected={routing}
      >
        <XStack>
          {routing ? (
            <XStack gap="$2" items="center">
              <Check size={16} color="var(--green11)" />
              <Text fontSize="$3" color="$green11" fontWeight="600">
                Smart routing enabled
              </Text>
            </XStack>
          ) : (
            <PrimaryButton
              size="$3"
              disabled={routingBusy}
              icon={routingBusy ? <Spinner size="small" color="$color1" /> : <Wand2 size={15} />}
              onPress={() => void enableRouter()}
            >
              Use Hanzo (smart routing)
            </PrimaryButton>
          )}
        </XStack>
      </ChoiceCard>

      <ChoiceCard
        icon={<KeyRound size={20} />}
        title="Bring your own API keys"
        description="Use your OpenAI, Anthropic, or Google keys. Stored encrypted in our secret store — never in plaintext."
        selected={connections.length > 0}
        badge={connections.length > 0 ? 'Connected' : undefined}
        onPress={() => setByoOpen((v) => !v)}
      >
        {connectedLabels ? (
          <Text fontSize="$2" color="$color11">
            Connected: {connectedLabels}
          </Text>
        ) : null}
        {byoOpen ? (
          <YStack gap="$2.5" pt="$1">
            <XStack gap="$2" flexWrap="wrap">
              <YStack width={160}>
                <FieldSelect
                  value={providerLabel(provider)}
                  options={AI_CONNECTION_PROVIDERS.map((p) => p.label)}
                  onChange={(l) => setProvider(providerFromLabel(l))}
                />
              </YStack>
              <YStack flex={1} minW={200}>
                <FieldText
                  value={apiKey}
                  onChange={(v) => {
                    setApiKey(v)
                    if (err) setErr(null)
                  }}
                  secure
                  placeholder={AI_CONNECTION_PROVIDERS.find((p) => p.id === provider)?.keyHint ?? 'API key'}
                />
              </YStack>
            </XStack>
            <XStack>
              <PrimaryButton
                size="$3"
                disabled={connecting || !apiKey.trim()}
                icon={connecting ? <Spinner size="small" color="$color1" /> : <Plus size={15} />}
                onPress={() => void connect()}
              >
                {connecting ? 'Connecting…' : `Connect ${providerLabel(provider)}`}
              </PrimaryButton>
            </XStack>
          </YStack>
        ) : null}
      </ChoiceCard>

      <ChoiceCard
        icon={<LogIn size={20} />}
        title="Connect a provider login"
        description="Sign in to your ChatGPT, Claude, or Gemini account with OAuth — no API key to paste."
        onPress={() => setOauthOpen((v) => !v)}
      >
        {oauthOpen ? (
          <YStack gap="$2.5" pt="$1">
            <XStack gap="$2" flexWrap="wrap" items="center">
              <YStack width={160}>
                <FieldSelect
                  value={providerLabel(oauthProvider)}
                  options={AI_CONNECTION_PROVIDERS.map((p) => p.label)}
                  onChange={(l) => {
                    setOauthProvider(providerFromLabel(l))
                    if (err) setErr(null)
                  }}
                />
              </YStack>
              <PrimaryButton
                size="$3"
                disabled={oauthBusy || oauthUnavailable.includes(oauthProvider)}
                icon={oauthBusy ? <Spinner size="small" color="$color1" /> : <LogIn size={15} />}
                onPress={() => void startOauth()}
              >
                {oauthBusy ? 'Redirecting…' : `Sign in with ${providerLabel(oauthProvider)}`}
              </PrimaryButton>
            </XStack>
            {oauthUnavailable.includes(oauthProvider) ? (
              <Text fontSize="$2" color="$color10">
                {providerLabel(oauthProvider)} login isn’t available on this deployment yet. Use “Bring your own
                API keys” above to connect {providerLabel(oauthProvider)} with a key.
              </Text>
            ) : (
              <Text fontSize="$2" color="$color10">
                You’ll be redirected to {providerLabel(oauthProvider)} to authorize, then returned here. The
                connection is sealed securely — no key is stored in your browser.
              </Text>
            )}
          </YStack>
        ) : null}
      </ChoiceCard>

      {err ? (
        <Text fontSize="$2" color="$red10">
          {err}
        </Text>
      ) : null}
    </StepShell>
  )
}
