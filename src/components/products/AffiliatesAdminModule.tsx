'use client'

/**
 * Affiliates (admin) — the GLOBAL-ADMIN operator board over cloud-api's
 * `GET /v1/admin/affiliates` + the `:id/{approve,suspend,payout}` mutations +
 * `POST /v1/admin/affiliates/sweep` (cloud `clients/affiliates`). Applications →
 * approve/suspend, the accrued/pending/paid ledger, a per-affiliate record-payout
 * flow (credits → commerce grant; cash → record-only), and a "Run sweep" action (the
 * periodic accrual path). Reads/writes terminate at the global-admin-gated
 * `app/admin/aggregate` proxy (server 403 for a non-admin); the UI adds honest
 * states, never a fabricated ledger. `admin: true` hides the entry from customers.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { BadgeCheck, Ban, Coins, HandCoins, Handshake, Percent, RefreshCw, Users, Wallet, Zap } from '@hanzogui/lucide-icons-2'

import { AdminAffiliatesApi, type AdminAffiliate, type AdminAffiliatesView, type SweepResult } from '~/lib/api/admin-affiliates'
import { MetricCard } from '~/components/ui/Metric'
import { asApiError, ErrorState, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { ApiError } from '~/lib/api'
import { dollarsToCents, percentToBps, ratePct, shortDate, statusLabel, statusColor, usd } from './affiliates/logic'
import { toneColor } from '~/components/ui/tone'
import { EmptyState, FieldRow, FieldSelect, FieldText, PageHeader, PrimaryButton } from '@hanzo/ui/product'

/** The backend caps the DIRECT (L1) rate at 9300 bps so the L1+L2+L3 schedule ≤ 100% of margin. */
const MAX_RATE_BPS = 9300

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; data: T }

/** The inline action editor, keyed to one affiliate. */
type Action =
  | { kind: 'approve'; aff: AdminAffiliate; code: string }
  | { kind: 'payout'; aff: AdminAffiliate; amount: string; method: string; reference: string }
  | { kind: 'rate'; aff: AdminAffiliate; percent: string }
  | null

const PAYOUT_METHODS = ['credits', 'wire', 'paypal', 'ach', 'check']

export function AffiliatesAdminModule() {
  const [state, setState] = useState<Async<AdminAffiliatesView>>({ phase: 'loading' })
  const [sweeping, setSweeping] = useState(false)
  const [lastSweep, setLastSweep] = useState<SweepResult | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AdminAffiliatesApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const runSweep = useCallback(() => {
    setSweeping(true)
    AdminAffiliatesApi.sweep()
      .then((r) => {
        setLastSweep(r)
        load()
      })
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
      .finally(() => setSweeping(false))
  }, [load])

  const suspend = useCallback(
    (aff: AdminAffiliate) => {
      setBusy(true)
      setActionErr(null)
      AdminAffiliatesApi.suspend(aff.id)
        .then(() => {
          setAction(null)
          load()
        })
        .catch((e) => setActionErr(e instanceof Error ? e.message : 'Suspend failed'))
        .finally(() => setBusy(false))
    },
    [load],
  )

  const confirmAction = useCallback(() => {
    if (!action) return
    setBusy(true)
    setActionErr(null)
    const done = () => {
      setAction(null)
      load()
    }
    const fail = (e: unknown) => setActionErr(e instanceof Error ? e.message : 'Action failed')
    if (action.kind === 'approve') {
      AdminAffiliatesApi.approve(action.aff.id, action.code.trim() || undefined)
        .then(done)
        .catch(fail)
        .finally(() => setBusy(false))
    } else if (action.kind === 'rate') {
      const bps = percentToBps(action.percent)
      if (bps == null || bps > MAX_RATE_BPS) {
        setActionErr(`Enter a rate between 0 and ${MAX_RATE_BPS / 100}%.`)
        setBusy(false)
        return
      }
      AdminAffiliatesApi.setRate(action.aff.id, bps)
        .then(done)
        .catch(fail)
        .finally(() => setBusy(false))
    } else {
      const cents = dollarsToCents(action.amount)
      if (cents == null) {
        setActionErr('Enter a positive dollar amount.')
        setBusy(false)
        return
      }
      AdminAffiliatesApi.payout(action.aff.id, { amountCents: cents, method: action.method, reference: action.reference.trim() })
        .then(done)
        .catch(fail)
        .finally(() => setBusy(false))
    }
  }, [action, load])

  return (
    <YStack gap="$3">
      <PageHeader
        title="Affiliates"
        subtitle="Partner-commission program — applications, commission accrual, and payouts."
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            <Button size="$3" icon={<Zap size={15} />} onPress={runSweep} disabled={sweeping || state.phase === 'loading'}>
              {sweeping ? 'Sweeping…' : 'Run sweep'}
            </Button>
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={load} disabled={state.phase === 'loading'}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {lastSweep ? (
        <Text fontSize="$2" color="$color11">
          Last sweep: checked {lastSweep.swept} referred org(s) · accrued {lastSweep.accrued} new period(s).
        </Text>
      ) : null}

      {action ? (
        <ActionEditor
          action={action}
          busy={busy}
          error={actionErr}
          onChange={setAction}
          onConfirm={confirmAction}
          onCancel={() => {
            setAction(null)
            setActionErr(null)
          }}
        />
      ) : null}

      {state.phase === 'loading' ? (
        <XStack p="$6" justify="center">
          <Text color="$color11">Loading affiliates…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState
            err={state.err}
            onRetry={load}
            copy={{ notFound: 'The affiliates aggregate is not routed on this deployment yet (GET /v1/admin/affiliates).' }}
          />
        )
      ) : state.data.affiliates.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No affiliates yet"
          description="Partners appear here as organizations apply to the affiliate program."
          bullets={[
            'Source: GET /v1/admin/affiliates — the cloud affiliates store (Base/SQLite), global-admin only.',
            'Approve an application to mint its code; run a sweep to accrue this period’s commission.',
          ]}
        />
      ) : (
        <AffiliatesAdminReady
          data={state.data}
          onApprove={(aff) => {
            setActionErr(null)
            setAction({ kind: 'approve', aff, code: aff.requestedCode || '' })
          }}
          onPayout={(aff) => {
            setActionErr(null)
            setAction({ kind: 'payout', aff, amount: '', method: 'credits', reference: '' })
          }}
          onRate={(aff) => {
            setActionErr(null)
            setAction({ kind: 'rate', aff, percent: String(aff.rateBps / 100) })
          }}
          onSuspend={suspend}
        />
      )}
    </YStack>
  )
}

function ActionEditor({
  action,
  busy,
  error,
  onChange,
  onConfirm,
  onCancel,
}: {
  action: NonNullable<Action>
  busy: boolean
  error: string | null
  onChange: (a: Action) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$color11">
      <XStack items="center" gap="$2">
        {action.kind === 'approve' ? (
          <BadgeCheck size={16} color={toneColor('positive')} />
        ) : action.kind === 'rate' ? (
          <Percent size={16} color={toneColor('warning')} />
        ) : (
          <HandCoins size={16} color="$color11" />
        )}
        <Text fontSize="$4" fontWeight="700">
          {action.kind === 'approve' ? 'Approve affiliate' : action.kind === 'rate' ? 'Set commission rate' : 'Record payout'} ·{' '}
          {action.aff.org}
        </Text>
      </XStack>

      {action.kind === 'approve' ? (
        <YStack gap="$1">
          <FieldRow label="Affiliate code">
            <FieldText
              value={action.code}
              onChange={(code) => onChange({ ...action, code })}
              disabled={busy}
              placeholder="blank → use their requested code or auto-generate"
            />
          </FieldRow>
          <Text fontSize="$1" color="$color10">
            3–32 chars of a–z, 0–9, hyphen. Must be unique across affiliates (approval fails 409 on a collision).
          </Text>
        </YStack>
      ) : action.kind === 'rate' ? (
        <YStack gap="$1">
          <FieldRow label="Direct (L1) commission rate %">
            <FieldText
              value={action.percent}
              onChange={(percent) => onChange({ ...action, percent })}
              disabled={busy}
              placeholder="e.g. 20 — currently at that % of Hanzo’s margin"
            />
          </FieldRow>
          <Text fontSize="$1" color="$color10">
            0–{MAX_RATE_BPS / 100}%. This is the affiliate’s share OF HANZO’S MARGIN. The cap leaves headroom for the
            L2/L3 upline so the whole schedule can never exceed the margin.
          </Text>
        </YStack>
      ) : (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11">
            Pending commission available: <Text fontWeight="700">{usd(action.aff.pendingCents)}</Text>
          </Text>
          <XStack gap="$3" flexWrap="wrap">
            <YStack flex={1} minW={140} gap="$1">
              <FieldRow label="Amount (USD)">
                <FieldText value={action.amount} onChange={(amount) => onChange({ ...action, amount })} disabled={busy} placeholder="e.g. 20.00" />
              </FieldRow>
            </YStack>
            <YStack flex={1} minW={140} gap="$1">
              <FieldRow label="Method">
                <FieldSelect value={action.method} options={PAYOUT_METHODS} onChange={(method) => onChange({ ...action, method })} disabled={busy} />
              </FieldRow>
            </YStack>
            <YStack flex={2} minW={180} gap="$1">
              <FieldRow label="Reference">
                <FieldText value={action.reference} onChange={(reference) => onChange({ ...action, reference })} disabled={busy} placeholder="txn / wire ref (optional)" />
              </FieldRow>
            </YStack>
          </XStack>
          <Text fontSize="$1" color="$color10">
            “credits” issues a cloud-credit grant into the affiliate’s wallet; every other method is recorded only. A
            payout can’t exceed pending commission.
          </Text>
        </YStack>
      )}

      {error ? (
        <Text fontSize="$2" color={toneColor('critical')}>
          {error}
        </Text>
      ) : null}
      <XStack gap="$2">
        <PrimaryButton size="$3" onPress={onConfirm} disabled={busy}>
          {busy ? 'Working…' : action.kind === 'approve' ? 'Approve' : action.kind === 'rate' ? 'Set rate' : 'Record payout'}
        </PrimaryButton>
        <Button size="$3" onPress={onCancel} disabled={busy}>
          Cancel
        </Button>
      </XStack>
    </Card>
  )
}

function AffiliatesAdminReady({
  data,
  onApprove,
  onPayout,
  onSuspend,
  onRate,
}: {
  data: AdminAffiliatesView
  onApprove: (a: AdminAffiliate) => void
  onPayout: (a: AdminAffiliate) => void
  onSuspend: (a: AdminAffiliate) => void
  onRate: (a: AdminAffiliate) => void
}) {
  const s = data.summary
  return (
    <YStack gap="$4">
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Users size={16} color={toneColor('muted')} />} label="Affiliates" value={String(s.total)} caption={`${s.approved} approved · ${s.applied} pending`} />
        <MetricCard icon={<HandCoins size={16} color="$color11" />} label="Accrued" value={usd(s.accruedCents)} caption="lifetime commission" />
        <MetricCard icon={<Coins size={16} color={toneColor('warning')} />} label="Pending" value={usd(s.pendingCents)} caption="owed, unpaid" />
        <MetricCard icon={<Wallet size={16} color={toneColor('positive')} />} label="Paid out" value={usd(s.paidCents)} caption="commission paid" />
      </XStack>

      <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
        <XStack px="$4" py="$3" bg="$color2" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
          <Text flex={2} minW={180} fontSize="$2" fontWeight="700" color="$color11">
            Affiliate
          </Text>
          <Text flex={1} minW={90} fontSize="$2" fontWeight="700" color="$color11">
            Code
          </Text>
          <Text flex={1} minW={80} fontSize="$2" fontWeight="700" color="$color11">
            Status
          </Text>
          <Text flex={1} minW={64} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Rate
          </Text>
          <Text flex={1} minW={72} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Referred
          </Text>
          <Text flex={1} minW={90} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Pending
          </Text>
          <Text flex={2} minW={200} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Actions
          </Text>
        </XStack>
        {data.affiliates.map((a) => (
          <XStack
            key={a.id}
            px="$4"
            py="$3"
            gap="$3"
            items="center"
            borderBottomWidth={1}
            borderColor="$borderColor"
            flexWrap="wrap"
          >
            <YStack flex={2} minW={180} gap="$0.5">
              <Text fontSize="$3" fontWeight="600" color="$color12">
                {a.org}
              </Text>
              <Text fontSize="$1" color="$color10">
                {a.paidCents ? `${usd(a.paidCents)} paid` : 'no payouts'} · applied {shortDate(a.createdAt)}
              </Text>
            </YStack>
            <Text flex={1} minW={90} fontSize="$2" style={{ fontFamily: 'monospace' }} color="$color11">
              {a.code || (a.requestedCode ? `${a.requestedCode}?` : '—')}
            </Text>
            <Text flex={1} minW={80} fontSize="$2" fontWeight="700" color={statusColor(a.status)}>
              {statusLabel(a.status)}
            </Text>
            <Text flex={1} minW={64} fontSize="$2" color="$color11" text="right">
              {ratePct(a.rateBps)}
            </Text>
            <Text flex={1} minW={72} fontSize="$3" color="$color12" text="right">
              {a.referredCount}
            </Text>
            <Text flex={1} minW={90} fontSize="$3" color="$color12" text="right">
              {a.pendingCents ? usd(a.pendingCents) : '—'}
            </Text>
            <XStack flex={2} minW={200} gap="$2" justify="flex-end" flexWrap="wrap">
              {a.status === 'applied' ? (
                <Button size="$2" icon={<BadgeCheck size={13} />} onPress={() => onApprove(a)}>
                  Approve
                </Button>
              ) : null}
              {a.status === 'suspended' ? (
                <Button size="$2" icon={<BadgeCheck size={13} />} onPress={() => onApprove(a)}>
                  Reactivate
                </Button>
              ) : null}
              {a.status === 'approved' ? (
                <>
                  <Button size="$2" icon={<Percent size={13} />} onPress={() => onRate(a)}>
                    Rate
                  </Button>
                  <Button size="$2" icon={<HandCoins size={13} />} onPress={() => onPayout(a)} disabled={a.pendingCents <= 0}>
                    Pay out
                  </Button>
                  <Button size="$2" icon={<Ban size={13} />} onPress={() => onSuspend(a)}>
                    Suspend
                  </Button>
                </>
              ) : null}
              {a.status !== 'approved' && a.pendingCents > 0 ? (
                <Button size="$2" icon={<HandCoins size={13} />} onPress={() => onPayout(a)}>
                  Pay out
                </Button>
              ) : null}
            </XStack>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}
