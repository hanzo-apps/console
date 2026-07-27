'use client'

/**
 * AI Providers — the platform-wide provider CONTROL board (admin.hanzo.ai).
 *
 * GLOBAL-ADMIN ONLY. This is the MANAGEMENT dashboard for the shared-gateway
 * provider routing (do-ai, openrouter, fireworks, openai-direct, zen) — one row per
 * upstream provider with a working Enabled toggle, a Primary indicator + "Make
 * primary" action, model count, a Key present/missing pill (NEVER the key), and an
 * honest DERIVED health verdict. It is DISTINCT from the customer-facing
 * `ProvidersModule` (the model-catalog browser + BYOK per-org provider CRUD) — this
 * one flips backend Provider `State`/`IsDefault` that applies to every org.
 *
 * DO-first is the BACKEND's state, not a UI assumption: the board renders exactly
 * what `GET /v1/admin/providers` returns (on first light-up do-ai is enabled +
 * primary, the rest disabled). Toggling Enabled → `ProviderAdminApi.toggle` PERSISTS
 * (writes Provider `State`) and refetches; "Make primary" → `setPrimary` refetches so
 * exactly one row is primary.
 *
 * Health is HONEST — a pure function of (enabled, keyPresent), labeled as derived,
 * not a live probe: disabled ⇒ Off; enabled + keyPresent ⇒ Ready; enabled + no key
 * ⇒ No key. No fabricated green.
 *
 * States are honest end to end: loading (Spinner), operator-access-required (403 →
 * the shared `OperatorAccessRequired` panel — a signed-in non-admin reads "admin
 * only", NEVER "sign in"), listing-unavailable (404), error (retry), empty.
 *
 * All calls go through the origin-pinned admin client → the global-admin-gated
 * `/admin/aggregate` proxy. The browser holds no credential and never sees a key.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { CheckCircle2, RefreshCw, Star, XCircle } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { ProviderAdminApi, deriveHealth, type AdminProvider, type ProviderHealth } from '~/lib/api/provider-admin'
import { config } from '~/config'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { FieldSwitch } from '@hanzo/ui/product'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired, type HonestCopy } from '~/components/ui/States'

/** Provider-board guidance for the honest 404 / unauthorized states. */
const PROVIDERS_COPY: HonestCopy = {
  notFound:
    'The provider control board requires hanzoai/ai with the /v1/admin/providers surface. Rows appear automatically once the admin backend routes it — provider keys are never listed, only whether one is present.',
  unauthorized:
    'This is the platform-wide provider control board — it changes shared-gateway routing for every org. Access is enforced server-side by the admin gate; sign in with an @hanzo.ai admin account.',
}

const rowKey = (p: AdminProvider): string => p.name

/** Honest health verdict → display label + tone. Off is neutral (an expected state,
 *  not an error); No key is a real warning (enabled but broken). */
const HEALTH_LABEL: Record<ProviderHealth, string> = { ready: 'Ready', 'no-key': 'No key', off: 'Off' }
const HEALTH_BG = { ready: '$color5', 'no-key': '$color4', off: '$color3' } as const
const HEALTH_FG = { ready: '$color12', 'no-key': '$color12', off: '$color10' } as const

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; rows: AdminProvider[] }

export function ProviderAdminModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  // The provider name currently mid-mutation (toggle/primary) — disables its own row
  // controls so a double-tap can't fire two writes.
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    ProviderAdminApi.list()
      .then((rows) => setState({ phase: 'ready', rows }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const toggle = useCallback(
    async (p: AdminProvider) => {
      setBusy(p.name)
      // NO optimistic flip: the enabled state changes ONLY when the server confirms
      // (2xx → the returned row). This board flips SHARED-gateway routing for every
      // org, so a slow 403 must never briefly render an unauthorized "on" state — the
      // row stays as-is (its switch disabled via `busy`) until the write is confirmed.
      try {
        const updated = await ProviderAdminApi.toggle(p.name, !p.enabled)
        setState((s) =>
          s.phase === 'ready'
            ? { phase: 'ready', rows: s.rows.map((r) => (r.name === updated.name ? updated : r)) }
            : s,
        )
      } catch {
        run() // authoritative refetch — the board reflects real backend state on any failure
      } finally {
        setBusy(null)
      }
    },
    [run],
  )

  const makePrimary = useCallback(
    async (p: AdminProvider) => {
      if (p.primary) return
      setBusy(p.name)
      try {
        // setPrimary returns the FULL updated list (old primary flipped off), so one
        // round-trip re-renders with exactly one primary.
        const rows = await ProviderAdminApi.setPrimary(p.name)
        setState({ phase: 'ready', rows })
      } catch {
        run()
      } finally {
        setBusy(null)
      }
    },
    [run],
  )

  const columns: Column<AdminProvider>[] = [
    {
      key: 'provider',
      header: 'Provider',
      render: (p) => (
        <XStack gap="$2.5" items="center">
          <ProviderLogo provider={p.name} size={26} />
          <YStack gap="$0.5">
            <Text fontSize="$3" fontWeight="700" numberOfLines={1}>
              {p.displayName || p.name}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {p.type || p.name}
            </Text>
          </YStack>
        </XStack>
      ),
    },
    {
      key: 'enabled',
      header: 'Enabled',
      width: 96,
      render: (p) => (
        <FieldSwitch checked={p.enabled} onChange={() => void toggle(p)} disabled={busy === p.name} />
      ),
    },
    {
      key: 'primary',
      header: 'Primary',
      width: 150,
      render: (p) =>
        p.primary ? (
          <XStack gap="$1.5" items="center" px="$2" py="$1" rounded="$3" bg="$color5" self="flex-start">
            <Star size={13} color="$color12" />
            <Text fontSize="$1" fontWeight="700" color="$color12">
              Primary
            </Text>
          </XStack>
        ) : (
          <Button
            size="$1"
            chromeless
            icon={<Star size={13} />}
            disabled={busy === p.name || !p.enabled}
            onPress={() => void makePrimary(p)}
          >
            Make primary
          </Button>
        ),
    },
    {
      key: 'modelCount',
      header: 'Models',
      width: 84,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {p.modelCount > 0 ? p.modelCount : '—'}
        </Text>
      ),
    },
    {
      key: 'key',
      header: 'Key',
      width: 104,
      render: (p) => (
        <XStack gap="$1.5" items="center">
          {p.keyPresent ? <CheckCircle2 size={14} color="$green10" /> : <XCircle size={14} color="$color9" />}
          <Text fontSize="$2" color={p.keyPresent ? '$color12' : '$color10'}>
            {p.keyPresent ? 'Present' : 'Missing'}
          </Text>
        </XStack>
      ),
    },
    {
      key: 'health',
      header: 'Health',
      width: 92,
      render: (p) => {
        const h = deriveHealth(p)
        return (
          <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg={HEALTH_BG[h]} color={HEALTH_FG[h]} self="flex-start">
            {HEALTH_LABEL[h]}
          </Text>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="AI Providers"
        subtitle="Enable, disable, and set the primary upstream provider for the shared gateway. Changes apply to every org."
        actions={
          <XStack gap="$2" items="center">
            {busy ? <Spinner size="small" color="$color11" /> : null}
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {/* Honest health + the OpenRouter→pricing integration callout, so an admin
          knows a toggle here is not just gateway routing — it also gates the pricing
          catalog for OpenRouter (the DO-first ENABLE_OPENROUTER integration). */}
      <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={860}>
        <Text fontSize="$4" fontWeight="700">
          Shared-gateway routing
        </Text>
        <Text fontSize="$3" color="$color11">
          These providers back every org&rsquo;s inference. Exactly one is primary (the default route);
          the rest serve as configured fallbacks. Health is derived from the enabled state and whether the
          KMS-backed key resolves — Ready means enabled with a key present, not a live probe. Keys are never
          shown, only whether one is present.
        </Text>
        <Text fontSize="$2" color="$color10">
          Note: disabling <Text fontWeight="700" color="$color11">OpenRouter</Text> here also removes its models
          from the pricing catalog — the pricing sync reads the provider-enabled state (the DO-first
          ENABLE_OPENROUTER integration).
        </Text>
      </Card>

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <OperatorAccessRequired />
        ) : (
          <ErrorState err={state.err} onRetry={run} copy={PROVIDERS_COPY} />
        )
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={rowKey}
          empty="No providers configured yet. Providers appear here once the shared gateway is wired."
        />
      )}

      <Text fontSize="$2" color="$color10">
        endpoint · /v1/admin/providers · {config.brandName}
      </Text>
    </>
  )
}
