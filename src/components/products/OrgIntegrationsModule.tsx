'use client'

/**
 * Org Integrations — the customer-facing "connect your tools" page. A logged-in org
 * connects Slack / GitHub (and any provider the cloud connector framework registers)
 * via a Connect button that runs the ORG-AUTHED OAuth flow through the canonical `/v1`
 * client — the surface that answers "I can't just hit an API endpoint unauthed": the
 * button POSTs `/v1/integrations/:provider/connect` (bearer minted server-side, org from
 * the token owner), then top-level-navigates to the returned provider authorize URL.
 *
 * Works for ANY org: every call is org-scoped SERVER-SIDE by the minted bearer, and the
 * `X-Org-Id` the client stamps is `currentOrg()` (the brand org by default, or the org a
 * global admin switched to) — nothing is hardcoded to a single org.
 *
 * The provider `callback` (state-authed, Slack-initiated) 302s the browser back here at
 * `/integrations?connected=<id>&account=<label>` (or `?error=<id>&reason=<msg>`); this
 * module reads that query on mount and shows an honest success/error toast + refetches.
 * Every state is honest — loading spinner, `BackendStateCard` on failure, empty state
 * when the framework returns no providers. Only providers whose OAuth is configured
 * on this deployment (`available`) or already connected are listed, so every card
 * has a live Connect/Disconnect action — no dead-end.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Cable, Plug, RefreshCw, GitBranch } from '@hanzogui/lucide-icons-2'

import { ApiError, IntegrationsApi, type IntegrationProvider as Provider } from '~/lib/api'
import { PageHeader } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { StatusTag } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { BackendStateCard, classifyRead, type BackendState } from '@hanzo/ui/product'
import { useToast } from '@hanzo/ui/product'
import { GitHubReposView } from '~/components/products/integrations/GitHubReposView'

/** Format an RFC3339 (or any Date-parseable) timestamp; degrade to the raw value. */
function fmtWhen(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

/** One provider card — mark, name, description, status, connection facts, action. */
function ProviderCard({
  p,
  busy,
  onConnect,
  onDisconnect,
  onManageRepos,
}: {
  p: Provider
  busy: boolean
  onConnect: (p: Provider) => void
  onDisconnect: (p: Provider) => void
  onManageRepos?: (p: Provider) => void
}) {
  return (
    <Card width={300} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <XStack items="center" gap="$3">
        <ProviderLogo provider={p.id} size={36} />
        <YStack flex={1} minW={0}>
          <Text fontSize="$5" fontWeight="700" color="$color12" numberOfLines={1}>
            {p.name}
          </Text>
          {p.category ? (
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {p.category}
            </Text>
          ) : null}
        </YStack>
        <StatusTag status={p.connected ? 'Connected' : 'Not connected'} />
      </XStack>

      {p.description ? (
        <Text fontSize="$2" color="$color11" numberOfLines={3} minH={52}>
          {p.description}
        </Text>
      ) : null}

      {p.connected && p.connection ? (
        <YStack gap="$1">
          {p.connection.account ? (
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              Account: {p.connection.account}
            </Text>
          ) : null}
          {p.connection.connectedAt ? (
            <Text fontSize="$1" color="$color10">
              Connected {fmtWhen(p.connection.connectedAt)}
            </Text>
          ) : null}
        </YStack>
      ) : null}

      <XStack items="center" justify="flex-end" gap="$2" mt="$1" flexWrap="wrap">
        {p.connected && onManageRepos ? (
          <Button size="$3" onPress={() => onManageRepos(p)} icon={<GitBranch size={15} />}>
            Repositories
          </Button>
        ) : null}
        {p.connected ? (
          <Button size="$3" onPress={() => onDisconnect(p)} disabled={busy} icon={busy ? undefined : <Plug size={15} />}>
            {busy ? <Spinner size="small" color="$color11" /> : 'Disconnect'}
          </Button>
        ) : (
          <PrimaryButton
            size="$3"
            onPress={() => onConnect(p)}
            disabled={!p.available || busy}
            icon={busy ? undefined : <Plug size={15} />}
          >
            {busy ? <Spinner size="small" /> : 'Connect'}
          </PrimaryButton>
        )}
      </XStack>
    </Card>
  )
}

export function OrgIntegrationsModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const search = useSearchParams() ?? new URLSearchParams()
  const toast = useToast()

  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  /** The provider id currently mid connect/disconnect (per-card busy spinner). */
  const [busyId, setBusyId] = useState('')
  /** Non-empty when the GitHub repositories sub-view is open (the provider id). */
  const [reposFor, setReposFor] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    IntegrationsApi.list()
      .then((ps) => {
        setProviders(ps)
        setError(null)
      })
      .catch((e) => {
        setProviders([])
        // A read is never credit-gated — classifyRead maps a 402 → empty, not a paywall.
        setError(classifyRead(e))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => load(), [load])

  // Handle the OAuth callback return. The provider callback 302s the browser to
  // /integrations?connected=<id>&account=<label> (success) or ?error=<id>&reason=<msg>.
  // Read the primitives (stable by value) so this runs once per return; the guard +
  // the router.replace that strips the params keep it from re-toasting on refetch.
  const connectedId = search.get('connected')
  const erroredId = search.get('error')
  const account = search.get('account')
  const reason = search.get('reason')
  useEffect(() => {
    if (!connectedId && !erroredId) return
    if (connectedId) {
      toast.success(`Connected ${connectedId}`, account ? `Account: ${account}` : undefined)
      load()
    } else if (erroredId) {
      toast.error(`Could not connect ${erroredId}`, reason || 'The connection could not be completed.')
    }
    // Strip the callback params so a refresh/refetch doesn't re-toast.
    router.replace('/integrations')
  }, [connectedId, erroredId, account, reason, toast, router, load])

  const onConnect = useCallback(
    async (p: Provider) => {
      if (!p.available) return
      setBusyId(p.id)
      try {
        const { authorizeUrl } = await IntegrationsApi.connect(p.id)
        if (authorizeUrl) {
          // Top-level navigation to the provider's authorize page (leaves the app).
          window.location.href = authorizeUrl
          return
        }
        toast.error(`Could not connect ${p.name}`, 'No authorization URL was returned.')
      } catch (e) {
        toast.error(`Could not connect ${p.name}`, e instanceof ApiError ? e.message : 'Please try again.')
      } finally {
        setBusyId('')
      }
    },
    [toast],
  )

  const onDisconnect = useCallback(
    async (p: Provider) => {
      if (typeof window !== 'undefined' && !window.confirm(`Disconnect ${p.name}? Hanzo will stop accessing your ${p.name} workspace.`)) {
        return
      }
      setBusyId(p.id)
      try {
        await IntegrationsApi.disconnect(p.id)
        toast.success(`Disconnected ${p.name}`)
        load()
      } catch (e) {
        toast.error(`Could not disconnect ${p.name}`, e instanceof ApiError ? e.message : 'Please try again.')
      } finally {
        setBusyId('')
      }
    },
    [toast, load],
  )

  const header = (
    <PageHeader
      title="Integrations"
      subtitle="Connect your tools so Hanzo AI can work across them"
      actions={
        <Button size="$3" chromeless icon={<RefreshCw size={15} />} onPress={() => load()} aria-label="Refresh" />
      }
    />
  )

  // ── GitHub repositories sub-view (opened from the connected GitHub card) ─────
  if (reposFor === 'github') {
    return <GitHubReposView onBack={() => setReposFor('')} />
  }

  // ── Initial loading ─────────────────────────────────────────────────────────
  if (loading && providers.length === 0 && !error) {
    return (
      <YStack gap="$4">
        {header}
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      </YStack>
    )
  }

  // ── Honest backend failure ────────────────────────────────────────────────────
  if (error) {
    return (
      <YStack gap="$4">
        {header}
        <BackendStateCard state={error} onRetry={() => load()} hint="endpoint · GET /v1/integrations" />
      </YStack>
    )
  }

  // Only connectors whose OAuth is configured on this deployment (available) or
  // already connected are shown — an unconfigured provider is omitted, so every card
  // has a live Connect/Disconnect action (no dead-end). Nothing fabricated.
  const visible = providers.filter((p) => p.available || p.connected)

  // ── Honest empty (no connectable providers on this deployment) ───────────────
  if (visible.length === 0) {
    return (
      <YStack gap="$4">
        {header}
        <EmptyState
          icon={Cable}
          title="No integrations available yet"
          description="Connectors light up here as they are configured on this deployment. Nothing is fabricated — real providers appear automatically."
        />
      </YStack>
    )
  }

  // ── The Connect card grid — wraps/stacks on mobile via flexWrap ──────────────
  return (
    <YStack gap="$4">
      {header}
      <XStack flexWrap="wrap" gap="$3">
        {visible.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            busy={busyId === p.id}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onManageRepos={p.id === 'github' ? (pr) => setReposFor(pr.id) : undefined}
          />
        ))}
      </XStack>
    </YStack>
  )
}
