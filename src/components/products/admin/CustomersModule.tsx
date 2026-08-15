'use client'

/**
 * admin.hanzo.ai CUSTOMERS board — the operator cockpit's core: the live fleet
 * customer list (incl. new self-serve signups), one-customer detail, and the audited
 * management ACTIONS (grant credit, suspend, reactivate).
 *
 * GLOBAL-ADMIN ONLY (`admin: true` hides it from every customer surface; the
 * `/v1/admin/customers*` aggregate is server-gated by `getAdminGate` — a customer
 * or org-admin can never reach fleet data). Every number is a real commerce + IAM
 * read; the actions are real (a commerce deposit / an IAM isForbidden flip), audited
 * server-side. NO card data is ever shown (the backend never sends it); an API key's
 * PRESENCE is shown, never its value.
 */
import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, Ban, Building2, CheckCircle2, CreditCard, RefreshCw, Users } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { AdminCockpitApi, type CustomerDetail, type CustomerRow, type GrantSource } from '~/lib/api/admin-cockpit'
import { MetricCard } from '~/components/ui/Metric'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { DataTable, EmptyState, PageHeader, type Column } from '@hanzo/ui/product'
import { usd } from '~/lib/money'

const shortDate = (s: string): string => (s ? (s.split('T')[0] ?? s) : '—')

function StatusBadge({ status }: { status: string }) {
  const suspended = status === 'suspended'
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$1" rounded="$3" bg={suspended ? '$red3' : '$green3'}>
      <Text fontSize="$1" color={suspended ? '$red11' : '$green11'}>{suspended ? 'Suspended' : 'Active'}</Text>
    </XStack>
  )
}

const INPUT_BASE: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--borderColor)',
  borderRadius: 8,
  padding: '8px 10px',
  color: 'var(--color12)',
}

/** What a grant submit carries — amount (cents), the source bucket, optional reason. */
export type GrantInput = { amountCents: number; source: GrantSource; reason?: string }

/**
 * A stable-per-attempt idempotency key for a credit grant. Minted ONCE when the grant
 * panel mounts and reused verbatim on every submit (incl. a retry after a timed-out
 * attempt), so commerce dedupes the retry to the ONE deposit; a NEW panel mounts a fresh
 * key. Guarded for a non-secure-context runtime (matches platform-apps/drawer.tsx) where
 * `crypto.randomUUID` is absent — the fallback is still unique-per-attempt.
 */
const newIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * The ONE grant-credit form — reused by the per-ROW quick action (list) and the
 * customer DETAIL view, so both open the same audited flow. Owns its own inputs
 * (amount / source / reason) and validates locally; the parent owns the API call,
 * the busy flag, and the success/error notice. A `source` toggle (Trial | Prepaid)
 * defaults to Trial — comps are non-cash credit; Prepaid is real money.
 */
function GrantCreditPanel({
  display,
  busy,
  onCancel,
  onSubmit,
}: {
  display: string
  busy: boolean
  onCancel: () => void
  onSubmit: (input: GrantInput, idempotencyKey: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [source, setSource] = useState<GrantSource>('trial')
  const [localErr, setLocalErr] = useState<string | null>(null)
  // One key per panel mount — reused on retry (this instance persists across a failed
  // submit), fresh on the next open (a new mount). Lazy init: minted exactly once.
  const [idempotencyKey] = useState(newIdempotencyKey)

  const submit = () => {
    const dollars = parseFloat(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setLocalErr('Enter a positive amount.')
      return
    }
    setLocalErr(null)
    onSubmit({ amountCents: Math.round(dollars * 100), source, reason: reason.trim() || undefined }, idempotencyKey)
  }

  return (
    <YStack p="$4" gap="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <Text fontSize="$4" color="$color12">Grant credit to {display}</Text>
      <Text fontSize="$1" color="$color10">
        A real commerce deposit into this org’s wallet. Trial = non-cash comp (welcome / starter / support);
        Prepaid = real money. Spend draws trial-first. Audited.
      </Text>
      <YStack gap="$1">
        <Text fontSize="$1" color="$color10">Source</Text>
        <XStack gap="$2">
          {(['trial', 'prepaid'] as const).map((s) => (
            <Button
              key={s}
              size="$2"
              bg={source === s ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              disabled={busy}
              onPress={() => setSource(s)}
            >
              {s === 'trial' ? 'Trial credit' : 'Prepaid'}
            </Button>
          ))}
        </XStack>
      </YStack>
      <XStack gap="$3" items="flex-end" flexWrap="wrap">
        <YStack gap="$1">
          <Text fontSize="$1" color="$color10">Amount (USD)</Text>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" inputMode="decimal"
            style={{ ...INPUT_BASE, width: 120 }} />
        </YStack>
        <YStack gap="$1" flex={1} minW={200}>
          <Text fontSize="$1" color="$color10">Reason</Text>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="support comp"
            style={{ ...INPUT_BASE, width: '100%' }} />
        </YStack>
        <XStack gap="$2">
          <Button size="$3" chromeless disabled={busy} onPress={onCancel}>Cancel</Button>
          <Button size="$3" disabled={busy} onPress={submit}>{busy ? 'Granting…' : 'Grant'}</Button>
        </XStack>
      </XStack>
      {localErr ? <Text fontSize="$2" color="$red11">{localErr}</Text> : null}
    </YStack>
  )
}

/** Human summary of a completed grant for the notice banner. */
const grantNotice = (source: GrantSource, res: { grantedCents: number; balanceCents: number; transactionId: string }): string =>
  `Granted ${usd(res.grantedCents)} ${source === 'trial' ? 'trial credit' : 'prepaid'} · new balance ${usd(res.balanceCents)} · tx ${res.transactionId}`

export function CustomersModule() {
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // Per-row quick-grant: the customer whose grant panel is open (null = closed).
  const [grantFor, setGrantFor] = useState<CustomerRow | null>(null)
  const [grantBusy, setGrantBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setRows(await AdminCockpitApi.customers())
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submitGrant = useCallback(async (input: GrantInput, idempotencyKey: string) => {
    if (!grantFor) return
    setGrantBusy(true)
    setNotice(null)
    try {
      const res = await AdminCockpitApi.grantCredit(grantFor.org, input, idempotencyKey)
      setNotice({ ok: true, msg: grantNotice(input.source, res) })
      setGrantFor(null)
      await load()
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setGrantBusy(false)
    }
  }, [grantFor, load])

  if (selected) return <CustomerDetailView org={selected} onBack={() => { setSelected(null); void load() }} />

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Customers" /><ErrorState err={err} onRetry={load} /></YStack>

  const totalBal = rows.reduce((s, r) => s + r.balanceCents, 0)
  const totalSpend = rows.reduce((s, r) => s + r.spendCents, 0)
  const suspended = rows.filter((r) => r.status === 'suspended').length

  const columns: Column<CustomerRow>[] = [
    { key: 'org', header: 'Customer', render: (r) => (
      <YStack>
        <Text fontSize="$3" color="$color12">{r.display}</Text>
        <Text fontSize="$1" color="$color10">{r.ownerEmail || r.org}</Text>
      </YStack>
    ) },
    { key: 'plan', header: 'Plan', render: (r) => <Text fontSize="$2" color="$color11">{r.plan}</Text> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'users', header: 'Users', render: (r) => <Text fontSize="$2" color="$color11">{r.users}</Text> },
    { key: 'balanceCents', header: 'Balance', render: (r) => <Text fontSize="$2" color="$green11">{usd(r.balanceCents)}</Text> },
    { key: 'spendCents', header: 'Spend', render: (r) => <Text fontSize="$2" color="$color11">{usd(r.spendCents)}</Text> },
    { key: 'mrrCents', header: 'MRR', render: (r) => <Text fontSize="$2" color="$color11">{r.mrrCents ? usd(r.mrrCents) : '—'}</Text> },
    { key: 'lastActive', header: 'Last active', render: (r) => <Text fontSize="$1" color="$color10">{shortDate(r.lastActive)}</Text> },
    // Per-ROW quick action — opens the SAME grant flow for this org without leaving the
    // list. `stopPropagation` so the button click doesn't also open the row's detail view.
    { key: 'grant', header: '', width: 96, align: 'right', render: (r) => (
      <Button
        size="$2"
        chromeless
        icon={<CreditCard size={14} />}
        onPress={(e) => { e.stopPropagation?.(); setNotice(null); setGrantFor(r) }}
      >
        Grant
      </Button>
    ) },
  ]

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Customers"
        subtitle="Every organization on the platform — balances, usage, and access. Global-admin only."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Users size={16} />} label="Customers" value={String(rows.length)} caption={suspended ? `${suspended} suspended` : 'all active'} />
        <MetricCard icon={<CreditCard size={16} />} label="Total balances" value={usd(totalBal)} caption="prepaid credit held" />
        <MetricCard icon={<Building2 size={16} />} label="Total spend" value={usd(totalSpend)} caption="realized usage" />
      </XStack>

      {notice && (
        <XStack p="$3" rounded="$4" bg={notice.ok ? '$green3' : '$red3'}>
          <Text fontSize="$2" color={notice.ok ? '$green11' : '$red11'}>{notice.msg}</Text>
        </XStack>
      )}

      {grantFor && (
        // `key` = the org: switching the quick-grant to a DIFFERENT customer remounts the
        // panel, so it mints a fresh idempotency key (a distinct grant) rather than reusing
        // the prior org's. A retry of the SAME org keeps the same mount, hence the same key.
        <GrantCreditPanel
          key={grantFor.org}
          display={grantFor.display}
          busy={grantBusy}
          onCancel={() => setGrantFor(null)}
          onSubmit={submitGrant}
        />
      )}

      <DataTable<CustomerRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="No customers yet."
        rowKey={(r) => r.org}
        onRowPress={(r) => setSelected(r.org)}
      />
    </YStack>
  )
}

// ── one-customer detail + management actions ─────────────────────────────────

function CustomerDetailView({ org, onBack }: { org: string; onBack: () => void }) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showCredit, setShowCredit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setDetail(await AdminCockpitApi.customer(org))
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [org])

  useEffect(() => {
    void load()
  }, [load])

  const grant = useCallback(async (input: GrantInput, idempotencyKey: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await AdminCockpitApi.grantCredit(org, input, idempotencyKey)
      setNotice({ ok: true, msg: grantNotice(input.source, res) })
      setShowCredit(false)
      await load()
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy(false)
    }
  }, [org, load])

  const toggleSuspend = useCallback(async (suspend: boolean) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = suspend ? await AdminCockpitApi.suspend(org) : await AdminCockpitApi.reactivate(org)
      const failed = res.failed.length ? ` (${res.failed.length} user(s) not updated)` : ''
      setNotice({ ok: res.failed.length === 0, msg: `${suspend ? 'Suspended' : 'Reactivated'} ${res.affected.length} user(s)${failed}` })
      await load()
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy(false)
    }
  }, [org, load])

  const back = <Button size="$3" chromeless icon={<ArrowLeft size={16} />} onPress={onBack}>Customers</Button>

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err) return <YStack p="$4" gap="$4">{back}<ErrorState err={err} onRetry={load} /></YStack>
  if (loading || !detail) return <YStack p="$4" gap="$4">{back}<PageHeader title={org} /><Text color="$color10">Loading…</Text></YStack>

  const d = detail
  const suspended = d.status === 'suspended'

  const userCols: Column<CustomerDetail['users'][number]>[] = [
    { key: 'name', header: 'User', render: (u) => (
      <YStack><Text fontSize="$2" color="$color12">{u.name}{u.isAdmin ? ' · admin' : ''}</Text><Text fontSize="$1" color="$color10">{u.email}</Text></YStack>
    ) },
    { key: 'hasApiKey', header: 'API key', render: (u) => <Text fontSize="$1" color={u.hasApiKey ? '$green11' : '$color9'}>{u.hasApiKey ? 'present' : '—'}</Text> },
    { key: 'forbidden', header: 'Access', render: (u) => <Text fontSize="$1" color={u.forbidden ? '$red11' : '$green11'}>{u.forbidden ? 'suspended' : 'active'}</Text> },
    { key: 'lastSignin', header: 'Last sign-in', render: (u) => <Text fontSize="$1" color="$color10">{shortDate(u.lastSignin)}</Text> },
  ]
  const txCols: Column<CustomerDetail['transactions'][number]>[] = [
    { key: 'time', header: 'When', render: (t) => <Text fontSize="$1" color="$color10">{shortDate(t.time)}</Text> },
    { key: 'type', header: 'Type', render: (t) => <Text fontSize="$2" color={t.type === 'deposit' ? '$green11' : '$color11'}>{t.type}</Text> },
    { key: 'cents', header: 'Amount', render: (t) => <Text fontSize="$2" color="$color12">{usd(t.cents)}</Text> },
    { key: 'notes', header: 'Notes', render: (t) => <Text fontSize="$1" color="$color10">{t.notes ?? ''}</Text> },
  ]

  return (
    <YStack p="$4" gap="$4">
      {back}
      <PageHeader
        title={d.display}
        subtitle={`${d.ownerEmail || d.org} · ${d.plan} · joined ${shortDate(d.created)}`}
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$3" icon={<CreditCard size={15} />} disabled={busy} onPress={() => { setShowCredit((v) => !v); setNotice(null) }}>Grant credit</Button>
            {suspended
              ? <Button size="$3" icon={<CheckCircle2 size={15} />} disabled={busy} onPress={() => void toggleSuspend(false)}>Reactivate</Button>
              : <Button size="$3" theme="red" icon={<Ban size={15} />} disabled={busy} onPress={() => void toggleSuspend(true)}>Suspend</Button>}
          </XStack>
        }
      />

      {notice && (
        <XStack p="$3" rounded="$4" bg={notice.ok ? '$green3' : '$red3'}>
          <Text fontSize="$2" color={notice.ok ? '$green11' : '$red11'}>{notice.msg}</Text>
        </XStack>
      )}

      {showCredit && (
        <GrantCreditPanel display={d.display} busy={busy} onCancel={() => setShowCredit(false)} onSubmit={grant} />
      )}

      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<CreditCard size={16} />} label="Balance" value={usd(d.balanceCents)} caption="available credit" />
        <MetricCard icon={<Building2 size={16} />} label="Spend" value={usd(d.spendCents)} caption="realized usage" />
        <MetricCard icon={<RefreshCw size={16} />} label="MRR" value={d.mrrCents ? usd(d.mrrCents) : '—'} caption="recurring" />
        <MetricCard icon={<Users size={16} />} label="Users · keys" value={`${d.users.length} · ${d.apiKeys}`} caption="members · API keys" />
      </XStack>

      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Members</Text>
        <DataTable<CustomerDetail['users'][number]> columns={userCols} rows={d.users} empty="No users." rowKey={(u) => u.name} />
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Top-ups & usage</Text>
        {d.transactions.length === 0
          ? <EmptyState icon={CreditCard} title="No transactions yet" description="Deposits and usage appear here as they happen." />
          : <DataTable<CustomerDetail['transactions'][number]> columns={txCols} rows={d.transactions} rowKey={(t) => t.id || t.time} />}
      </YStack>
    </YStack>
  )
}
