'use client'

/**
 * Subscriptions — the org's active subscriptions (plan, status, renewal, seats),
 * over the console's own per-tenant `/billing/*` proxy (server-injected service
 * token, scoped to the caller's org — the browser can't widen scope). Manage
 * IN-CONSOLE:
 *
 *  - CANCEL: a per-row cancel with an explicit "at the end of the period" vs "now"
 *    choice → `POST /v1/billing/subscriptions/:id/cancel` (`{atPeriodEnd}`).
 *  - REACTIVATE: when a subscription is scheduled to cancel at period end, undo it →
 *    `POST /v1/billing/subscriptions/:id/reactivate`.
 *
 * The `:id` always comes from the caller's OWN subscriptions list (already scoped by
 * the proxy), and commerce re-authorizes the id against the caller's server-pinned
 * subject. Honest loading / empty / error states via `BackendStateCard`; the row
 * reflects `cancelAtPeriodEnd` / `canceledAt`. The billing portal stays a fallback.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { CalendarClock, Check, ExternalLink, RefreshCw, RotateCcw, XCircle } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { BillingApi, type Subscription } from '~/lib/api/billing'
import { BackendStateCard, DataTable, PageHeader, StatusTag, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

const usd = (cents?: number): string => (cents != null ? `$${(cents / 100).toFixed(2)}` : '—')

const fmtDate = (s?: string): string => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

/** A canceled subscription (already ended) can no longer be canceled or reactivated. */
const isEnded = (s: Subscription): boolean => !!s.canceledAt || (s.status ?? '').toLowerCase() === 'canceled'

function openBillingPortal(): void {
  // The brand billing portal root (billing.<brand>) — a SECONDARY fallback only; the
  // primary manage flow is in-console.
  if (typeof window !== 'undefined') window.open(config.billingUrl, '_blank', 'noopener')
}

export function SubscriptionsModule(_props: { params: Record<string, string> }) {
  const [subs, setSubs] = useState<Async<Subscription[]>>({ phase: 'loading' })
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(() => {
    setSubs({ phase: 'loading' })
    BillingApi.subscriptions()
      .then((data) => setSubs({ phase: 'ready', data }))
      .catch((e) => setSubs({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const doCancel = useCallback(
    async (s: Subscription, atPeriodEnd: boolean) => {
      setCancelTarget(null)
      setBusyId(s.id)
      setMsg(null)
      try {
        await BillingApi.cancelSubscription(s.id, atPeriodEnd)
        setMsg({
          tone: 'ok',
          text: atPeriodEnd
            ? `“${s.plan}” will cancel at the end of the current period.`
            : `“${s.plan}” has been canceled.`,
        })
        load()
      } catch (e) {
        setMsg({ tone: 'err', text: `Could not cancel “${s.plan}”: ${classifyBackend(e).message}` })
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const doReactivate = useCallback(
    async (s: Subscription) => {
      setBusyId(s.id)
      setMsg(null)
      try {
        await BillingApi.reactivateSubscription(s.id)
        setMsg({ tone: 'ok', text: `“${s.plan}” has been reactivated.` })
        load()
      } catch (e) {
        setMsg({ tone: 'err', text: `Could not reactivate “${s.plan}”: ${classifyBackend(e).message}` })
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const columns: Column<Subscription>[] = [
    {
      key: 'plan',
      header: 'Plan',
      render: (r) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {r.plan}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 170,
      render: (r) => (
        <YStack gap={2}>
          {r.status ? <StatusTag status={r.status} /> : <Text fontSize="$3" color="$color10">—</Text>}
          {r.canceledAt ? (
            <Text fontSize="$1" color="$color10">Canceled {fmtDate(r.canceledAt)}</Text>
          ) : r.cancelAtPeriodEnd ? (
            <Text fontSize="$1" color="$yellow10">Cancels {fmtDate(r.currentPeriodEnd)}</Text>
          ) : null}
        </YStack>
      ),
    },
    {
      key: 'quantity',
      header: 'Seats',
      width: 80,
      render: (r) => <Text fontSize="$3" color="$color11">{r.quantity ?? '—'}</Text>,
    },
    {
      key: 'cents',
      header: 'Price',
      width: 120,
      render: (r) => (
        <Text fontSize="$3" color="$color12">
          {usd(r.cents)}
          {r.cents != null && r.interval ? <Text fontSize="$2" color="$color10">{` / ${r.interval}`}</Text> : null}
        </Text>
      ),
    },
    {
      key: 'currentPeriodEnd',
      header: 'Renews',
      width: 120,
      render: (r) => <Text fontSize="$3" color="$color11">{fmtDate(r.currentPeriodEnd)}</Text>,
    },
    {
      key: 'action',
      header: '',
      width: 130,
      render: (r) => {
        const busy = busyId === r.id
        if (isEnded(r)) return <Text fontSize="$2" color="$color10" text="right">Ended</Text>
        return (
          <XStack justify="flex-end" flex={1}>
            {r.cancelAtPeriodEnd ? (
              <Button
                size="$2"
                icon={<RotateCcw size={14} />}
                disabled={busy}
                opacity={busy ? 0.5 : 1}
                onPress={() => void doReactivate(r)}
                aria-label={`Reactivate ${r.plan}`}
              >
                {busy ? 'Working…' : 'Reactivate'}
              </Button>
            ) : (
              <Button
                size="$2"
                theme="red"
                chromeless
                icon={<XCircle size={14} />}
                disabled={busy}
                opacity={busy ? 0.5 : 1}
                onPress={() => {
                  setMsg(null)
                  setCancelTarget(r)
                }}
                aria-label={`Cancel ${r.plan}`}
              >
                {busy ? 'Working…' : 'Cancel subscription'}
              </Button>
            )}
          </XStack>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Plans your organization is subscribed to — status, seats, and renewal. Cancel or reactivate right here."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" theme="light" iconAfter={<ExternalLink size={14} />} onPress={openBillingPortal}>
              Billing portal
            </Button>
          </XStack>
        }
      />

      {/* One-shot status line for cancel/reactivate outcomes. */}
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

      {/* Cancel choice panel — an explicit "at period end" vs "now" decision. */}
      {cancelTarget ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$red6" bg="$red1" maxW={560}>
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Cancel “{cancelTarget.plan}”?
          </Text>
          <Text fontSize="$3" color="$color11">
            Cancel at the end of the current period to keep access until {fmtDate(cancelTarget.currentPeriodEnd)}, or
            cancel immediately to end it now.
          </Text>
          <XStack gap="$2" flexWrap="wrap">
            <Button
              size="$4"
              theme="light"
              icon={<CalendarClock size={16} />}
              onPress={() => void doCancel(cancelTarget, true)}
            >
              Cancel at period end
            </Button>
            <Button
              size="$4"
              theme="red"
              icon={<XCircle size={16} />}
              onPress={() => void doCancel(cancelTarget, false)}
            >
              Cancel now
            </Button>
            <Button size="$4" chromeless onPress={() => setCancelTarget(null)}>
              Keep subscription
            </Button>
          </XStack>
        </Card>
      ) : null}

      {subs.phase === 'error' ? (
        <BackendStateCard state={subs.error} onRetry={load} hint="endpoint · GET /v1/billing/subscriptions" />
      ) : (
        <DataTable
          columns={columns}
          rows={subs.phase === 'ready' ? subs.data : []}
          loading={subs.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No active subscriptions. Plans you subscribe to appear here."
        />
      )}
    </>
  )
}

