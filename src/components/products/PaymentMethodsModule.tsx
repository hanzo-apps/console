'use client'

/**
 * Payment Methods — the org's saved payment methods, over the console's own
 * per-tenant `/billing/*` proxy (server-injected service token, scoped to the
 * caller's org — the browser can't widen scope). Add + remove happen IN-CONSOLE:
 *
 *  - ADD: the card is entered ONLY in Square's cross-origin iframe (the shared
 *    `useSquareCard` capability, same as Add-credits) and tokenized IN THE BROWSER.
 *    We POST only the opaque single-use nonce (`token`) — the RAW PAN never touches
 *    our code, servers, or logs (PCI SAQ-A). `POST /v1/billing/methods`.
 *  - REMOVE: a per-row detach with a confirm — `DELETE /v1/billing/methods/:id`.
 *    Commerce authorizes the delete against the caller's server-pinned subject.
 *
 * Read-only + masked by construction on display: commerce returns ONLY a
 * non-sensitive descriptor (brand + last4 + expiry), which is all this renders. A
 * missing descriptor degrades to "—", never fabricated. Honest loading / empty /
 * error states via `BackendStateCard`. The billing portal remains a secondary link.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { CreditCard, ExternalLink, Plus, RefreshCw, ShieldCheck, Trash2, X, FlaskConical, Check } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { BillingApi, type PaymentConfig, type PaymentMethod } from '~/lib/api/billing'
import { isLiveSquareEnv } from '~/lib/billing/square'
import { useSquareCard } from '~/lib/billing/use-square-card'
import { BackendStateCard, DataTable, PageHeader, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

type ConfigState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; cfg: PaymentConfig }

type SaveState = { state: 'idle' } | { state: 'submitting' } | { state: 'error'; message: string }

/** Capitalized brand (visa → Visa), or the generic type, or "Card". */
const label = (m: PaymentMethod): string => {
  const b = m.brand?.trim()
  if (b) return b.charAt(0).toUpperCase() + b.slice(1)
  if (m.type) return m.type.charAt(0).toUpperCase() + m.type.slice(1)
  return 'Card'
}

/** •••• 4242 — the masked descriptor, or "—" when commerce reports no last4. */
const masked = (m: PaymentMethod): string => (m.last4 ? `•••• ${m.last4}` : '—')

/** A human, non-sensitive descriptor for a confirm/toast (brand + last4). */
const describe = (m: PaymentMethod): string => (m.last4 ? `${label(m)} •••• ${m.last4}` : label(m))

/** MM / YYYY expiry, or "—" when not a card / not reported. */
const expiry = (m: PaymentMethod): string => {
  if (m.expMonth == null || m.expYear == null) return '—'
  const mm = String(m.expMonth).padStart(2, '0')
  return `${mm} / ${m.expYear}`
}

function openBillingPortal(): void {
  // The brand billing portal root (billing.<brand>) — a SECONDARY fallback only; the
  // primary add/remove is in-console above.
  if (typeof window !== 'undefined') window.open(config.billingUrl, '_blank', 'noopener')
}

export function PaymentMethodsModule(_props: { params: Record<string, string> }) {
  const [methods, setMethods] = useState<Async<PaymentMethod[]>>({ phase: 'loading' })
  const [cfg, setCfg] = useState<ConfigState>({ phase: 'loading' })
  const [showAdd, setShowAdd] = useState(false)
  const [save, setSave] = useState<SaveState>({ state: 'idle' })
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(() => {
    setMethods({ phase: 'loading' })
    BillingApi.paymentMethods()
      .then((data) => setMethods({ phase: 'ready', data }))
      .catch((e) => setMethods({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Fetch the tenant's PUBLIC Square config once (cheap JSON, no secrets) so opening
  // the Add panel is instant; the heavy SDK load is gated on the panel being open.
  useEffect(() => {
    let alive = true
    BillingApi.paymentConfig()
      .then((c) => alive && setCfg({ phase: 'ready', cfg: c }))
      .catch((e) => alive && setCfg({ phase: 'error', error: classifyBackend(e) }))
    return () => {
      alive = false
    }
  }, [])

  const ready = cfg.phase === 'ready' ? cfg.cfg : null
  const configured = !!ready && !!ready.applicationId && !!ready.locationId
  // Mount Square's card iframe ONLY while the Add panel is open AND a processor is
  // configured — the shared PCI card capability (same as Add credits).
  const card = useSquareCard(showAdd && configured ? ready : null)

  const openAdd = useCallback(() => {
    setSave({ state: 'idle' })
    setMsg(null)
    setShowAdd(true)
  }, [])

  const closeAdd = useCallback(() => {
    setShowAdd(false)
    setSave({ state: 'idle' })
  }, [])

  const saveCard = useCallback(async () => {
    if (!card.ready || save.state === 'submitting') return
    setSave({ state: 'submitting' })
    try {
      // Tokenize IN Square's iframe → an opaque single-use nonce (never a PAN), then
      // save it. The proxy pins the billing subject server-side.
      const token = await card.tokenize()
      await BillingApi.createPaymentMethod({ type: 'card', token })
      setShowAdd(false)
      setSave({ state: 'idle' })
      setMsg({ tone: 'ok', text: 'Card added.' })
      load()
    } catch (e) {
      setSave({ state: 'error', message: e instanceof Error ? e.message : 'The card was not saved. Nothing was added to your organization — try again.' })
    }
  }, [card, save.state, load])

  const remove = useCallback(
    async (m: PaymentMethod) => {
      const desc = describe(m)
      if (typeof window !== 'undefined' && !window.confirm(`Remove ${desc}? This detaches it from your organization.`)) return
      setRemovingId(m.id)
      setMsg(null)
      try {
        await BillingApi.removePaymentMethod(m.id)
        setMsg({ tone: 'ok', text: `Removed ${desc}.` })
        load()
      } catch (e) {
        setMsg({ tone: 'err', text: `Could not remove ${desc}: ${classifyBackend(e).message}` })
      } finally {
        setRemovingId(null)
      }
    },
    [load],
  )

  const canSave = card.ready && save.state !== 'submitting'

  const columns: Column<PaymentMethod>[] = [
    {
      key: 'brand',
      header: 'Method',
      render: (m) => (
        <XStack items="center" gap="$2" flexWrap="wrap">
          <Text fontSize="$3" fontWeight="600" color="$color12">
            {label(m)}
          </Text>
          {m.isDefault ? (
            <YStack px="$2" py={1} rounded="$10" bg="$color5">
              <Text fontSize="$1" fontWeight="800" color="$color12" letterSpacing={0.4}>
                DEFAULT
              </Text>
            </YStack>
          ) : null}
        </XStack>
      ),
    },
    {
      key: 'last4',
      header: 'Number',
      width: 130,
      render: (m) => (
        <Text fontSize="$3" color="$color11" style={{ fontFamily: 'monospace' }}>
          {masked(m)}
        </Text>
      ),
    },
    {
      key: 'expiry',
      header: 'Expires',
      width: 110,
      render: (m) => <Text fontSize="$3" color="$color11">{expiry(m)}</Text>,
    },
    {
      key: 'action',
      header: '',
      width: 110,
      render: (m) => (
        <XStack justify="flex-end" flex={1}>
          <Button
            size="$2"
            theme="red"
            chromeless
            icon={<Trash2 size={14} />}
            disabled={removingId === m.id}
            opacity={removingId === m.id ? 0.5 : 1}
            onPress={() => void remove(m)}
            aria-label={`Remove card ${describe(m)}`}
          >
            {removingId === m.id ? 'Removing card…' : 'Remove card'}
          </Button>
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Payment Methods"
        subtitle="Saved payment methods for your organization. Add or remove a card right here — securely, in-console."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            {showAdd ? (
              <Button size="$2" icon={<X size={14} />} onPress={closeAdd}>
                Close
              </Button>
            ) : (
              <Button size="$2" theme="light" icon={<Plus size={14} />} onPress={openAdd}>
                Add card
              </Button>
            )}
          </XStack>
        }
      />

      {/* A one-shot status line for add/remove outcomes. */}
      {msg ? (
        <XStack
          items="center"
          gap="$2"
          p="$2.5"
          rounded="$3"
          bg={msg.tone === 'ok' ? '$green2' : '$red2'}
          borderWidth={1}
          borderColor={msg.tone === 'ok' ? '$green6' : '$red6'}
        >
          {msg.tone === 'ok' ? <Check size={15} color="$green10" /> : null}
          <Text fontSize="$2" color={msg.tone === 'ok' ? '$color12' : '$red10'}>
            {msg.text}
          </Text>
        </XStack>
      ) : null}

      {/* Add-card panel — the Square card iframe + Save. */}
      {showAdd ? (
        cfg.phase === 'loading' ? (
          <Card p="$4" borderWidth={1} borderColor="$borderColor" maxW={560}>
            <Text fontSize="$3" color="$color11">
              Loading secure card form…
            </Text>
          </Card>
        ) : cfg.phase === 'error' ? (
          <BackendStateCard state={cfg.error} hint="endpoint · GET /v1/billing/settings" />
        ) : !configured ? (
          <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxW={560}>
            <Text fontSize="$4" fontWeight="700" color="$color12">
              No card processor is configured for this organization
            </Text>
            <Text fontSize="$3" color="$color11">
              Adding a card in-console needs a payment processor connected to your organization. You can
              manage payment methods in the billing portal, or contact support to enable in-console cards.
            </Text>
            <XStack>
              <Button size="$3" iconAfter={<ExternalLink size={14} />} onPress={openBillingPortal}>
                Open billing portal
              </Button>
            </XStack>
          </Card>
        ) : (
          <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor" maxW={560}>
            <Text fontSize="$5" fontWeight="800" color="$color12">
              Add a card
            </Text>

            {ready && !isLiveSquareEnv(ready.environment) ? (
              <XStack items="center" gap="$2" p="$2.5" rounded="$3" bg="$yellow2" borderWidth={1} borderColor="$yellow6">
                <FlaskConical size={15} color="$yellow10" />
                <Text fontSize="$2" color="$color11">
                  Test mode (Square sandbox) — no real card is stored. Use test card 4111 1111 1111 1111, any
                  future expiry, any CVV, ZIP 12345.
                </Text>
              </XStack>
            ) : null}

            {/* Card field — Square's own iframe mounts here (we never see the PAN). */}
            <YStack gap="$2">
              <Text fontSize="$3" fontWeight="700" color="$color12">
                Card
              </Text>
              <Card p="$3" borderWidth={1} borderColor="$borderColor" bg="$color1">
                <div ref={card.containerRef} id="hz-pm-card-container" style={{ minHeight: 42 }} />
                {card.phase === 'mounting' ? (
                  <Text fontSize="$2" color="$color10">
                    Loading secure card field…
                  </Text>
                ) : null}
                {card.phase === 'error' ? (
                  <Text fontSize="$2" color="$red10">
                    {card.error || 'The secure card field did not load, so there is nowhere to type a card. Close this panel and open it again.'}
                  </Text>
                ) : null}
              </Card>
              <XStack items="center" gap="$1.5">
                <ShieldCheck size={13} color="$green10" />
                <Text fontSize="$1" color="$color10">
                  Card details go directly to Square and are encrypted. Hanzo never sees your card number.
                </Text>
              </XStack>
            </YStack>

            {save.state === 'error' ? (
              <XStack p="$2.5" rounded="$3" bg="$red2" borderWidth={1} borderColor="$red6">
                <Text fontSize="$2" color="$red10">
                  {save.message}
                </Text>
              </XStack>
            ) : null}

            <XStack gap="$2" flexWrap="wrap">
              <Button
                size="$4"
                theme="light"
                icon={<CreditCard size={16} />}
                disabled={!canSave}
                opacity={canSave ? 1 : 0.6}
                onPress={() => void saveCard()}
              >
                {save.state === 'submitting' ? 'Saving…' : 'Save card'}
              </Button>
              <Button size="$4" chromeless onPress={closeAdd} disabled={save.state === 'submitting'}>
                Cancel
              </Button>
            </XStack>
          </Card>
        )
      ) : null}

      {methods.phase === 'error' ? (
        <BackendStateCard state={methods.error} onRetry={load} hint="endpoint · GET /v1/billing/methods" />
      ) : (
        <DataTable
          columns={columns}
          rows={methods.phase === 'ready' ? methods.data : []}
          loading={methods.phase === 'loading'}
          rowKey={(m) => m.id}
          empty="No payment methods on file. Add a card to get started."
        />
      )}

      {/* Secondary: the brand billing portal stays available as a fallback. */}
      <XStack items="center" gap="$1.5">
        <ExternalLink size={13} opacity={0.6} />
        <Text
          fontSize="$2"
          color="$color11"
          cursor="pointer"
          hoverStyle={{ color: '$color12' }}
          onPress={openBillingPortal}
        >
          Manage in the billing portal →
        </Text>
      </XStack>
    </>
  )
}

