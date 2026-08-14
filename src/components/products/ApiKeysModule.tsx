'use client'

/**
 * API Keys — create, copy, rotate, and revoke the per-user `sk-` Cloud API key.
 *
 * The key is minted server-side (`/keys` route → IAM, app-on-behalf as the
 * confidential console client); the browser only sends its session cookie and
 * never holds a long-lived secret beyond the one-time reveal at creation. This
 * is the real credential the user presents as `Authorization: Bearer sk-…` to
 * the SDKs, CLI, and the api.hanzo.ai gateway.
 *
 * `ApiKeysView` is the bare surface so Settings can embed it as a tab;
 * `ApiKeysModule` wraps it with the page header for the standalone Dev route.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Copy, Check, KeyRound, RefreshCw, Trash2, TriangleAlert, Plus } from '@hanzogui/lucide-icons-2'

import { useAnalytics } from '@hanzo/event/react'
import { EVENTS } from '@hanzo/event'

import { ApiError, KeysApi, type KeyStatus } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { config } from '~/config'
import { ErrorState } from '~/components/ui/States'
import { toCurl } from '~/components/products/playground/request-preview'
import { CopyButton, PageHeader, SecretInput } from '@hanzo/ui/product'

// The docs site serves everything under the `/docs` base path (a bare
// `docs.hanzo.ai/<slug>` 404s), so the API reference is `/docs/api` — white-labeled
// off the brand's docs host.
const DOCS_API = `${config.docsUrl}/docs/api`

// The request a new key is FOR. A page that mints a credential and then says only
// "use it with the SDKs" leaves its reader to go and find out how; this is the
// smallest call that works, so the first request is a paste rather than a search.
//
// Built by the Playground's own toCurl, so the command copied here is byte-identical
// to the one copied there — one spelling of "how you call this API", not a second.
//
// `auto` is the model because it is the one that needs no catalog knowledge to run:
// routing picks the model. Measured against the live gateway with a real key —
// `auto` answers 402 insufficient_balance, which is the refusal this card describes,
// while a named model can answer 400 for its own reasons (zen5-mini: "Reasoning is
// mandatory for this endpoint"), which would read as a broken key on a first call.
const FIRST_CALL = toCurl({ model: 'auto', messages: [{ role: 'user', content: 'Hello' }] })

/** Honest date label for the key's last mint/rotate; empty string when unknown. */
function fmtKeyDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** The full secret, shown ONCE right after creation. */
function NewKeyCard({ accessKey, onDone }: { accessKey: string; onDone: () => void }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$green8" bg="$green2" maxWidth={720}>
      <XStack gap="$2" items="center">
        <KeyRound size={16} />
        <Text fontSize="$4" fontWeight="700">
          Your new API key
        </Text>
      </XStack>
      <SecretInput value={accessKey} id="api-key" />
      <XStack gap="$2" items="center">
        <TriangleAlert size={14} color="$yellow10" />
        <Text fontSize="$2" color="$color11">
          Copy it now — for your security the full key is shown only once and cannot be retrieved again.
        </Text>
      </XStack>
      <Button size="$2" self="flex-start" onPress={onDone}>
        Done
      </Button>
    </Card>
  )
}

/**
 * The request the key is for, and the one thing that will stop it working.
 *
 * Access here is money, not plan: a funded org may call anything and an unfunded one
 * is refused. That refusal is clean and says so, but only to whoever reads the
 * response body — so a first-time holder who has not topped up spends their first
 * minutes wondering whether they minted the key wrong. Saying it beside the key is
 * cheaper than letting them find out from a 402.
 */
function FirstCall({ onAddCredits }: { onAddCredits: () => void }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
      <Text fontSize="$4" fontWeight="700">
        Your first request
      </Text>
      <Text fontSize="$3" color="$color11">
        Export your key as <Text fontSize="$2" style={{ fontFamily: 'monospace' }}>HANZO_API_KEY</Text>, then run this.
      </Text>
      <YStack overflow="scroll" bg="$color2" rounded="$3" p="$3">
        <Text fontSize="$2" color="$color11" selectable style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>
          {FIRST_CALL}
        </Text>
      </YStack>
      <XStack gap="$2" items="center" flexWrap="wrap">
        <CopyButton value={FIRST_CALL} />
        <Button size="$2" chromeless onPress={onAddCredits}>
          Add credits
        </Button>
      </XStack>
      <Text fontSize="$2" color="$color11">
        Calls draw on the balance for this organization. With none, the answer is{' '}
        <Text fontSize="$2" style={{ fontFamily: 'monospace' }}>402 insufficient_balance</Text> — the key is fine,
        the wallet is empty.
      </Text>
    </Card>
  )
}

/** The credential surface — embeddable (no page header). */
export function ApiKeysView() {
  const { account, loading: sessionLoading } = useSession()
  const router = useRouter()
  const analytics = useAnalytics()
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<null | 'create' | 'rotate' | 'revoke'>(null)
  const [newKey, setNewKey] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await KeysApi.status())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load API key status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!sessionLoading && account) void load()
    else if (!sessionLoading) setLoading(false)
  }, [sessionLoading, account, load])

  const mint = useCallback(
    async (mode: 'create' | 'rotate') => {
      setWorking(mode)
      setError(null)
      try {
        const { accessKey } = await KeysApi.create()
        setNewKey(accessKey)
        setStatus({ hasKey: true, keyPrefix: accessKey.slice(0, 11), createdAt: new Date().toISOString() })
        if (mode === 'create') analytics.capture(EVENTS.API_KEY_CREATED)
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to create the API key')
      } finally {
        setWorking(null)
      }
    },
    [analytics],
  )

  const revoke = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm('Revoke your API key? Any app using it will stop working immediately.')) return
    setWorking('revoke')
    setError(null)
    try {
      await KeysApi.revoke()
      setNewKey('')
      setStatus({ hasKey: false, keyPrefix: '' })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to revoke the API key')
    } finally {
      setWorking(null)
    }
  }, [])

  if (sessionLoading || loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (!account) {
    return <ErrorState err={new ApiError('Not authorized', 401)} />
  }

  const hasKey = status?.hasKey ?? false

  return (
    <YStack gap="$3" maxW={720}>
      {error ? (
        <Card p="$3" gap="$2" borderWidth={1} borderColor="$red8" bg="$red2">
          <XStack gap="$2" items="center">
            <TriangleAlert size={15} color="$red10" />
            <Text fontSize="$3" color="$color12">
              {error}
            </Text>
          </XStack>
        </Card>
      ) : null}

      {newKey ? <NewKeyCard accessKey={newKey} onDone={() => setNewKey('')} /> : null}

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        {hasKey ? (
          <>
            <XStack gap="$2" items="center">
              <KeyRound size={16} />
              <YStack flex={1}>
                <Text fontSize="$4" fontWeight="700">
                  Cloud API key
                </Text>
                <Text fontSize="$2" color="$color10" style={{ fontFamily: 'monospace' }}>
                  {status?.keyPrefix ? `${status.keyPrefix}…` : 'sk-…'}
                </Text>
                {fmtKeyDate(status?.createdAt) ? (
                  <Text fontSize="$1" color="$color10">
                    Last created/rotated {fmtKeyDate(status?.createdAt)}
                  </Text>
                ) : null}
              </YStack>
            </XStack>
            <Text fontSize="$3" color="$color11">
              Your account has an active key. The full secret is shown only at creation; rotate to
              replace it (the old key stops working), or revoke it entirely.
            </Text>
            <XStack gap="$2" flexWrap="wrap">
              <Button
                size="$2"
                icon={<RefreshCw size={14} />}
                disabled={working !== null}
                onPress={() => void mint('rotate')}
              >
                {working === 'rotate' ? 'Rotating…' : 'Rotate'}
              </Button>
              <Button
                size="$2"
                icon={<Trash2 size={14} />}
                theme="red"
                disabled={working !== null}
                onPress={() => void revoke()}
              >
                {working === 'revoke' ? 'Revoking…' : 'Revoke'}
              </Button>
            </XStack>
          </>
        ) : (
          <>
            <XStack gap="$2" items="center">
              <KeyRound size={16} />
              <Text fontSize="$4" fontWeight="700">
                Create your Cloud API key
              </Text>
            </XStack>
            <Text fontSize="$3" color="$color11">
              One key for your account, scoped to your organization. Use it as{' '}
              <Text fontSize="$2" style={{ fontFamily: 'monospace' }}>Authorization: Bearer sk-…</Text> with the SDKs,
              CLI, and the api.hanzo.ai gateway.
            </Text>
            <Button
              size="$3"
              self="flex-start"
              bg="$color5"
              icon={<Plus size={16} />}
              disabled={working !== null}
              onPress={() => void mint('create')}
            >
              {working === 'create' ? 'Creating…' : 'Create API key'}
            </Button>
          </>
        )}
      </Card>

      {hasKey || newKey ? <FirstCall onAddCredits={() => router.push('/billing/credits')} /> : null}

      <Button
        size="$2"
        chromeless
        self="flex-start"
        onPress={() => {
          if (typeof window !== 'undefined') window.open(DOCS_API, '_blank', 'noopener')
        }}
      >
        API documentation
      </Button>
    </YStack>
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
