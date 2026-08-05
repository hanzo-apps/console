'use client'

/**
 * Authors (admin) — the GLOBAL-ADMIN operator board over cloud-api's
 * `GET /v1/admin/authors` + the `:id/{approve,suspend,payout}` mutations +
 * `POST /v1/admin/authors/sweep` (cloud `clients/authors`). Connections →
 * approve/suspend, the accrued/pending/paid ledger, a per-author record-payout
 * flow (credits → commerce grant; cash → record-only), and a "Run sweep" action (the
 * periodic accrual path). Reads/writes terminate at the global-admin-gated
 * `app/admin/aggregate` proxy (server 403 for a non-admin); the UI adds honest
 * states, never a fabricated ledger. `admin: true` hides the entry from customers.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { BadgeCheck, Ban, Coins, Github, HandCoins, RefreshCw, Wallet, Zap } from '@hanzogui/lucide-icons-2'

import { AdminAuthorsApi, type AdminAuthor, type AdminAuthorsView, type SweepResult } from '~/lib/api/admin-authors'
import { MetricCard } from '~/components/ui/Metric'
import { asApiError, ErrorState, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { ApiError } from '~/lib/api'
import { dollarsToCents, sharePct, shortDate, statusLabel, statusColor, usd } from './authors/logic'
import { toneColor } from '~/components/ui/tone'
import { EmptyState, FieldRow, FieldSelect, FieldText, PageHeader, PrimaryButton } from '@hanzo/ui/product'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; data: T }

/** The inline action editor, keyed to one author. */
type Action =
  | { kind: 'approve'; author: AdminAuthor; share: string }
  | { kind: 'payout'; author: AdminAuthor; amount: string; method: string; reference: string }
  | null

const PAYOUT_METHODS = ['credits', 'wire', 'paypal', 'ach', 'check']

export function AuthorsAdminModule() {
  const [state, setState] = useState<Async<AdminAuthorsView>>({ phase: 'loading' })
  const [sweeping, setSweeping] = useState(false)
  const [lastSweep, setLastSweep] = useState<SweepResult | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AdminAuthorsApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const runSweep = useCallback(() => {
    setSweeping(true)
    AdminAuthorsApi.sweep()
      .then((r) => {
        setLastSweep(r)
        load()
      })
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
      .finally(() => setSweeping(false))
  }, [load])

  const suspend = useCallback(
    (author: AdminAuthor) => {
      setBusy(true)
      setActionErr(null)
      AdminAuthorsApi.suspend(author.id)
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
      // Share % → basis points (blank = default = 0 = keep default share).
      const pct = action.share.trim()
      const shareBps = pct === '' ? undefined : Math.round(Number(pct) * 100)
      if (shareBps != null && (!Number.isFinite(shareBps) || shareBps < 0)) {
        setActionErr('Enter a non-negative share percent, or leave blank for the default.')
        setBusy(false)
        return
      }
      AdminAuthorsApi.approve(action.author.id, shareBps)
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
      AdminAuthorsApi.payout(action.author.id, { amountCents: cents, method: action.method, reference: action.reference.trim() })
        .then(done)
        .catch(fail)
        .finally(() => setBusy(false))
    }
  }, [action, load])

  return (
    <YStack gap="$3">
      <PageHeader
        title="Authors"
        subtitle="OSS-author royalty program — verifications, deploys, accruals, and payouts."
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
          Last sweep: checked {lastSweep.swept} deployed author(s) · accrued {lastSweep.accrued} new period(s).
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
          <Text color="$color11">Loading authors…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState
            err={state.err}
            onRetry={load}
            copy={{ notFound: 'The authors aggregate is not routed on this deployment yet (GET /v1/admin/authors).' }}
          />
        )
      ) : state.data.authors.length === 0 ? (
        <EmptyState
          icon={Github}
          title="No authors yet"
          description="Open-source authors appear here as they connect GitHub and verify their repositories."
          bullets={[
            'Source: GET /v1/admin/authors — the cloud authors store (Base/SQLite), global-admin only.',
            'Approve a connection to start their earnings; run a sweep to accrue this period’s royalties.',
          ]}
        />
      ) : (
        <AuthorsAdminReady
          data={state.data}
          onApprove={(author) => {
            setActionErr(null)
            setAction({ kind: 'approve', author, share: '' })
          }}
          onPayout={(author) => {
            setActionErr(null)
            setAction({ kind: 'payout', author, amount: '', method: 'credits', reference: '' })
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
        {action.kind === 'approve' ? <BadgeCheck size={16} color={toneColor('positive')} /> : <HandCoins size={16} color="$color11" />}
        <Text fontSize="$4" fontWeight="700">
          {action.kind === 'approve' ? 'Approve author' : 'Record payout'} · {action.author.org}
        </Text>
      </XStack>

      {action.kind === 'approve' ? (
        <YStack gap="$1">
          <FieldRow label="Share % (blank = default)">
            <FieldText
              value={action.share}
              onChange={(share) => onChange({ ...action, share })}
              disabled={busy}
              placeholder="e.g. 5 — leave blank to keep the default share"
            />
          </FieldRow>
          <Text fontSize="$1" color="$color10">
            The percent of deploying-org spend this author earns. Blank keeps the program default.
          </Text>
        </YStack>
      ) : (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11">
            Pending royalties available: <Text fontWeight="700">{usd(action.author.pendingCents)}</Text>
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
            “credits” issues a cloud-credit grant into the author’s wallet; every other method is recorded only. A payout
            can’t exceed pending royalties.
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
          {busy ? 'Working…' : action.kind === 'approve' ? 'Approve' : 'Record payout'}
        </PrimaryButton>
        <Button size="$3" onPress={onCancel} disabled={busy}>
          Cancel
        </Button>
      </XStack>
    </Card>
  )
}

function AuthorsAdminReady({
  data,
  onApprove,
  onPayout,
  onSuspend,
}: {
  data: AdminAuthorsView
  onApprove: (a: AdminAuthor) => void
  onPayout: (a: AdminAuthor) => void
  onSuspend: (a: AdminAuthor) => void
}) {
  const s = data.summary
  return (
    <YStack gap="$4">
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Github size={16} color={toneColor('muted')} />} label="Authors" value={String(s.total)} caption={`${s.approved} approved · ${s.connected} pending`} />
        <MetricCard icon={<HandCoins size={16} color="$color11" />} label="Accrued" value={usd(s.accruedCents)} caption="lifetime royalties" />
        <MetricCard icon={<Coins size={16} color={toneColor('warning')} />} label="Pending" value={usd(s.pendingCents)} caption="owed, unpaid" />
        <MetricCard icon={<Wallet size={16} color={toneColor('positive')} />} label="Paid out" value={usd(s.paidCents)} caption="royalties paid" />
      </XStack>

      <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
        <XStack px="$4" py="$3" bg="$color2" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
          <Text flex={2} minW={160} fontSize="$2" fontWeight="700" color="$color11">
            Org
          </Text>
          <Text flex={1} minW={110} fontSize="$2" fontWeight="700" color="$color11">
            GitHub
          </Text>
          <Text flex={1} minW={80} fontSize="$2" fontWeight="700" color="$color11">
            Status
          </Text>
          <Text flex={1} minW={60} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Repos
          </Text>
          <Text flex={1} minW={64} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Deploys
          </Text>
          <Text flex={1} minW={80} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Accrued
          </Text>
          <Text flex={1} minW={80} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Pending
          </Text>
          <Text flex={1} minW={72} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Paid
          </Text>
          <Text flex={2} minW={200} fontSize="$2" fontWeight="700" color="$color11" text="right">
            Actions
          </Text>
        </XStack>
        {data.authors.map((a) => (
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
            <YStack flex={2} minW={160} gap="$0.5">
              <Text fontSize="$3" fontWeight="600" color="$color12">
                {a.org}
              </Text>
              <Text fontSize="$1" color="$color10">
                {a.verified ? 'verified' : 'unverified'} · connected {shortDate(a.createdAt)}
              </Text>
            </YStack>
            <Text flex={1} minW={110} fontSize="$2" style={{ fontFamily: 'monospace' }} color="$color11">
              {a.githubLogin ? `@${a.githubLogin}` : '—'}
            </Text>
            <Text flex={1} minW={80} fontSize="$2" fontWeight="700" color={statusColor(a.status)}>
              {statusLabel(a.status)}
            </Text>
            <Text flex={1} minW={60} fontSize="$3" color="$color12" text="right">
              {a.repoCount}
            </Text>
            <Text flex={1} minW={64} fontSize="$3" color="$color12" text="right">
              {a.deployCount}
            </Text>
            <Text flex={1} minW={80} fontSize="$2" color="$color11" text="right">
              {a.accruedCents ? usd(a.accruedCents) : '—'}
            </Text>
            <Text flex={1} minW={80} fontSize="$3" color="$color12" text="right">
              {a.pendingCents ? usd(a.pendingCents) : '—'}
            </Text>
            <Text flex={1} minW={72} fontSize="$2" color="$color11" text="right">
              {a.paidCents ? usd(a.paidCents) : '—'}
            </Text>
            <XStack flex={2} minW={200} gap="$2" justify="flex-end" flexWrap="wrap">
              {a.status === 'connected' ? (
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
