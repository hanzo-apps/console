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
 * `/connectors?connected=<id>&account=<label>` (or `?error=<id>&reason=<msg>`); this
 * module reads that query on mount and shows an honest success/error toast + refetches.
 * Every state is honest — loading spinner, `BackendStateCard` on failure, empty state
 * when the framework returns no providers.
 *
 * The page lists the WHOLE registry. It used to drop any provider the deployment had
 * no app credentials for, which is why Google — registered, documented, and the one
 * the cap-table and document imports read — simply was not on the page: nothing said
 * it existed, so the only reading available was that we had dropped it. Absence is a
 * worse answer than an unavailable card. A provider without credentials says so on
 * its own card and its Connect is inert; `available` is a fact about the deployment,
 * not a reason to withhold the fact that the provider exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '~/lib/router'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Cable, Plug, RefreshCw, GitBranch } from '@hanzogui/lucide-icons-2'

import { ApiError, ConnectorsApi, type ConnectorProvider as Provider } from '~/lib/api'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { useToast } from '~/components/ui/Toast'
import { GitHubReposView } from '~/components/products/connectors/GitHubReposView'
import { BackendStateCard, EmptyState, PageHeader, PrimaryButton, StatusTag, classifyRead, type BackendState } from '@hanzo/ui/product'

/** Format an RFC3339 (or any Date-parseable) timestamp; degrade to the raw value. */
function fmtWhen(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

/**
 * The form a CREDENTIAL connector asks for, rendered from the catalog.
 *
 * Cloud publishes `fields` — name, label, whether it is secret — so this
 * component never learns which providers exist. Adding a connector on the
 * backend makes its form appear here with no change to this file, which is the
 * same reason the OAuth half publishes its scopes.
 *
 * A secret field is a password input: it is the org's real credential, and it
 * travels one way only. Nothing here reads a stored secret back — cloud seals it
 * into KMS and never returns it.
 */
function CredentialForm({
  p,
  busy,
  onSubmit,
}: {
  p: Provider
  busy: boolean
  onSubmit: (p: Provider, values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const missing = p.fields.some((f) => f.required && !(values[f.name] ?? '').trim())

  return (
    <YStack gap="$2">
      {p.fields.map((f) => (
        <YStack key={f.name} gap="$1">
          <Text fontSize="$1" color="$color11">
            {f.label}
            {f.required ? ' *' : ''}
          </Text>
          <Input
            size="$3"
            data-testid={`field-${p.id}-${f.name}`}
            secureTextEntry={f.secret}
            value={values[f.name] ?? ''}
            onChangeText={(v: string) => setValues((prev) => ({ ...prev, [f.name]: v }))}
          />
        </YStack>
      ))}
      <PrimaryButton
        size="$3"
        onPress={() => onSubmit(p, values)}
        disabled={busy || missing}
        icon={busy ? undefined : <Plug size={15} />}
      >
        {busy ? <Spinner size="small" /> : 'Connect'}
      </PrimaryButton>
      {/* Say what happens, because it is not a redirect: the credentials are
          checked against the provider before anything is stored, so a wrong
          paste is refused here rather than on the first real send. */}
      <Text fontSize="$1" color="$color10">
        Checked with {p.name} before they are saved.
      </Text>
    </YStack>
  )
}

/** One provider card — mark, name, description, status, connection facts, action. */
function ProviderCard({
  p,
  busy,
  focused,
  onConnect,
  onSubmitCredentials,
  onDisconnect,
  onManageRepos,
}: {
  p: Provider
  busy: boolean
  /** True when /connectors/<id> named this card: ring it and bring it into view. */
  focused?: boolean
  onConnect: (p: Provider) => void
  onSubmitCredentials: (p: Provider, values: Record<string, string>) => void
  onDisconnect: (p: Provider) => void
  onManageRepos?: (p: Provider) => void
}) {
  return (
    <Card
      width={300}
      p="$4"
      gap="$3"
      borderWidth={focused ? 2 : 1}
      borderColor={focused ? '$color12' : '$borderColor'}
      bg="$color1"
      data-testid={`provider-${p.id}`}
    >
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
        <StatusTag status={p.connected ? 'Connected' : p.available ? 'Not connected' : 'Unavailable'} />
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

      {/* Say WHY the button is inert, on the card, rather than leaving a dead control
          the reader has to guess about. The deployment holds no app credentials for
          this provider yet, and that is the whole of it. */}
      {!p.connected && !p.available && p.kind === 'oauth' ? (
        <Text fontSize="$1" color="$color10" data-testid={`unavailable-${p.id}`}>
          Awaiting app credentials on this deployment.
        </Text>
      ) : null}

      {/* A credential connector has no sign-in page to send anyone to, so the
          card carries the form itself rather than a button that would have
          nowhere to go. Connected, both kinds look the same — one Disconnect. */}
      {!p.connected && p.kind === 'credential' ? (
        <CredentialForm p={p} busy={busy} onSubmit={onSubmitCredentials} />
      ) : (
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
      )}
    </Card>
  )
}

export function OrgConnectorsModule({ params }: { params: Record<string, string> }) {
  /**
   * `/connectors/<provider>` deep-links one connector.
   *
   * It is a LINK worth sending someone — "go connect Cloudflare" is a sentence
   * with a URL — and until the route existed it answered the console's own
   * not-found page, which reads as the product being missing rather than the
   * address being wrong.
   *
   * The param does not route anywhere else: this page IS the list, so it scrolls
   * that card into view and rings it. A separate per-provider page would be a
   * second place to render the same card, and the thing a deep link is for is
   * arriving at the card you were sent to, not a different layout of it.
   */
  const focus = (params.provider ?? '').toLowerCase()

  const router = useRouter()
  const search = useSearchParams() ?? new URLSearchParams()
  const toast = useToast()

  const [providers, setProviders] = useState<Provider[]>([])

  // Bring the named card into view once the list has rendered. It queries the
  // `data-testid` the card already carries rather than threading a ref through
  // it: @hanzo/gui's Card takes a GuiElement ref, not an HTMLDivElement, and a
  // second identity for a node that already has one is the kind of thing that
  // silently stops matching. `block: 'center'` so the card a link points at is
  // not left tucked under the console header — arriving at a card you cannot see
  // is the same as not arriving.
  useEffect(() => {
    if (!focus) return
    const el = document.querySelector(`[data-testid="provider-${focus}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus, providers.length])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  /** The provider id currently mid connect/disconnect (per-card busy spinner). */
  const [busyId, setBusyId] = useState('')
  /** Non-empty when the GitHub repositories sub-view is open (the provider id). */
  const [reposFor, setReposFor] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    ConnectorsApi.list()
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
  // /connectors?connected=<id>&account=<label> (success) or ?error=<id>&reason=<msg>.
  //
  // The latch is what makes this ONE-SHOT, and it is not belt-and-braces. Stripping
  // the params with router.replace cannot do it alone: the replace is asynchronous, so
  // every render between raising the toast and the URL actually changing still reads
  // `connected` and would toast again. This effect also calls load(), whose state
  // updates cause exactly those renders. A latch says "this return was handled" once
  // and stays true regardless of how many times the effect is re-entered, or why.
  const connectedId = search.get('connected')
  const erroredId = search.get('error')
  const account = search.get('account')
  const reason = search.get('reason')
  const handledReturn = useRef(false)
  useEffect(() => {
    if (!connectedId && !erroredId) return
    if (handledReturn.current) return
    handledReturn.current = true
    if (connectedId) {
      toast.success(`Connected ${connectedId}`, account ? `Account: ${account}` : undefined)
      load()
    } else if (erroredId) {
      toast.error(`Could not connect ${erroredId}`, reason || 'No reason came back with it. Nothing is connected — press Connect to start again.')
    }
    // The latch covers this mount; stripping the params covers the NEXT one, so a
    // refresh or a back-navigation does not replay a connection that already happened.
    router.replace('/connectors')
  }, [connectedId, erroredId, account, reason, toast, router, load])

  const onConnect = useCallback(
    async (p: Provider) => {
      if (!p.available) return
      setBusyId(p.id)
      try {
        const { authorizeUrl } = await ConnectorsApi.connect(p.id)
        if (authorizeUrl) {
          // Top-level navigation to the provider's authorize page (leaves the app).
          window.location.href = authorizeUrl
          return
        }
        toast.error(`Could not connect ${p.name}`, `No ${p.name} sign-in page came back, so nothing was connected. Try again.`)
      } catch (e) {
        toast.error(`Could not connect ${p.name}`, e instanceof ApiError ? e.message : 'Nothing was connected. Try again.')
      } finally {
        setBusyId('')
      }
    },
    [toast],
  )

  /**
   * Connect a CREDENTIAL provider: the fields go up, cloud verifies them against
   * the provider and seals them, and the answer is final — there is no redirect
   * and nothing to come back from, so the list is reloaded in place.
   *
   * A refusal here means the provider rejected the credentials, which is the
   * useful thing to say: the paste is on screen and can be corrected now.
   */
  const onSubmitCredentials = useCallback(
    async (p: Provider, values: Record<string, string>) => {
      setBusyId(p.id)
      try {
        const res = await ConnectorsApi.connect(p.id, values)
        if (res.connected) {
          toast.success(`${p.name} connected`, res.account || undefined)
          await load()
          return
        }
        toast.error(`Could not connect ${p.name}`, 'Nothing was connected. Check the details and try again.')
      } catch (e) {
        toast.error(`Could not connect ${p.name}`, e instanceof ApiError ? e.message : 'Nothing was connected. Try again.')
      } finally {
        setBusyId('')
      }
    },
    [toast, load],
  )

  const onDisconnect = useCallback(
    async (p: Provider) => {
      if (typeof window !== 'undefined' && !window.confirm(`Disconnect ${p.name}? Hanzo will stop accessing your ${p.name} workspace.`)) {
        return
      }
      setBusyId(p.id)
      try {
        await ConnectorsApi.disconnect(p.id)
        toast.success(`Disconnected ${p.name}`)
        load()
      } catch (e) {
        toast.error(`Could not disconnect ${p.name}`, e instanceof ApiError ? e.message : 'It is still connected. Try again.')
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

  // ── Honest empty (the registry itself is empty) ──────────────────────────────
  if (providers.length === 0) {
    return (
      <YStack gap="$4">
        {header}
        <EmptyState
          icon={Cable}
          title="No integrations available yet"
          description="This deployment has no connectors registered yet. They appear here as they are added."
        />
      </YStack>
    )
  }

  // ── The Connect card grid — wraps/stacks on mobile via flexWrap ──────────────
  return (
    <YStack gap="$4">
      {header}
      <XStack flexWrap="wrap" gap="$3">
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            focused={focus === p.id}
            p={p}
            busy={busyId === p.id}
            onConnect={onConnect}
            onSubmitCredentials={onSubmitCredentials}
            onDisconnect={onDisconnect}
            onManageRepos={p.id === 'github' ? (pr) => setReposFor(pr.id) : undefined}
          />
        ))}
      </XStack>
    </YStack>
  )
}
