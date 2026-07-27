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
import { useCallback, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, Ban, Building2, CheckCircle2, CreditCard, RefreshCw, Users } from '@hanzogui/lucide-icons-2'

import { AdminCockpitApi, type CustomerDetail, type CustomerRow, type GrantSource } from '~/lib/api/admin-cockpit'
import { DASH, shortDate, usd } from '~/lib/format'
import { searchRows, useSort } from '~/lib/table'
import { useAdminResource } from '~/lib/hooks/useAdminResource'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { SearchInput } from '~/components/ui/Filters'
import { FieldText } from '~/components/ui/Field'
import { EmptyState } from '~/components/ui/EmptyState'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired } from '~/components/ui/States'

function StatusBadge({ status }: { status: string }) {
  const suspended = status === 'suspended'
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$1" rounded="$3" bg={suspended ? '$red3' : '$green3'}>
      <Text fontSize="$1" color={suspended ? '$red11' : '$green11'}>{suspended ? 'Suspended' : 'Active'}</Text>
    </XStack>
  )
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
        <YStack gap="$1" width={140}>
          <Text fontSize="$1" color="$color10">Amount (USD)</Text>
          <FieldText value={amount} onChange={setAmount} disabled={busy} placeholder="25.00" />
        </YStack>
        <YStack gap="$1" flex={1} minW={200}>
          <Text fontSize="$1" color="$color10">Reason</Text>
          <FieldText value={reason} onChange={setReason} disabled={busy} placeholder="support comp" />
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
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  // Per-row quick-grant: the customer whose grant panel is open (null = closed).
  const [grantFor, setGrantFor] = useState<CustomerRow | null>(null)
  const [grantBusy, setGrantBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)

  const { data, loading, err, reload } = useAdminResource(useCallback(() => AdminCockpitApi.customers(), []))
  const { sort, onSortChange, apply } = useSort('spendCents', 'desc')

  const all = useMemo(() => data ?? [], [data])
  const rows = useMemo(
    () => apply(searchRows(all, q, (r) => `${r.display} ${r.org} ${r.ownerEmail} ${r.plan} ${r.status}`)),
    [all, q, apply],
  )

  const submitGrant = useCallback(async (input: GrantInput, idempotencyKey: string) => {
    if (!grantFor) return
    setGrantBusy(true)
    setNotice(null)
    try {
      const res = await AdminCockpitApi.grantCredit(grantFor.org, input, idempotencyKey)
      setNotice({ ok: true, msg: grantNotice(input.source, res) })
      setGrantFor(null)
      await reload()
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setGrantBusy(false)
    }
  }, [grantFor, reload])

  if (selected) return <CustomerDetailView org={selected} onBack={() => { setSelected(null); void reload() }} />

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Customers" /><ErrorState err={err} onRetry={reload} /></YStack>

  const totalBal = all.reduce((s, r) => s + r.balanceCents, 0)
  const totalSpend = all.reduce((s, r) => s + r.spendCents, 0)
  const suspended = all.filter((r) => r.status === 'suspended').length

  const columns: Column<CustomerRow>[] = [
    // Sorts on `display` — the field the cell SHOWS; `org` is the row key, not the label.
    { key: 'display', header: 'Customer', sortable: true, render: (r) => (
      <YStack>
        <Text fontSize="$3" color="$color12">{r.display}</Text>
        <Text fontSize="$1" color="$color10">{r.ownerEmail || r.org}</Text>
      </YStack>
    ) },
    { key: 'plan', header: 'Plan', sortable: true },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <StatusBadge status={r.status} /> },
    { key: 'users', header: 'Users', align: 'right', mono: true, sortable: true },
    { key: 'balanceCents', header: 'Balance', align: 'right', mono: true, sortable: true, render: (r) => usd(r.balanceCents) },
    { key: 'spendCents', header: 'Spend', align: 'right', mono: true, sortable: true, render: (r) => usd(r.spendCents) },
    { key: 'mrrCents', header: 'MRR', align: 'right', mono: true, sortable: true, render: (r) => (r.mrrCents ? usd(r.mrrCents) : DASH) },
    { key: 'lastActive', header: 'Last active', align: 'right', mono: true, sortable: true, render: (r) => shortDate(r.lastActive) },
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
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={reload}>Refresh</Button>}
      />
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Users size={16} />} label="Customers" value={String(all.length)} caption={suspended ? `${suspended} suspended` : 'all active'} />
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

      <SearchInput value={q} onChange={setQ} placeholder="Search customers, orgs, owners, plans…" />

      <DataTable<CustomerRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty={q ? 'No customers match.' : 'No customers yet.'}
        rowKey={(r) => r.org}
        onRowPress={(r) => setSelected(r.org)}
        sort={sort}
        onSortChange={onSortChange}
      />
    </YStack>
  )
}

// ── one-customer detail + management actions ─────────────────────────────────

const userCols: Column<CustomerDetail['users'][number]>[] = [
  { key: 'name', header: 'User', sortable: true, render: (u) => (
    <YStack><Text fontSize="$2" color="$color12">{u.name}{u.isAdmin ? ' · admin' : ''}</Text><Text fontSize="$1" color="$color10">{u.email}</Text></YStack>
  ) },
  { key: 'hasApiKey', header: 'API key', sortable: true, render: (u) => <Text fontSize="$1" color={u.hasApiKey ? '$green11' : '$color9'}>{u.hasApiKey ? 'present' : DASH}</Text> },
  { key: 'forbidden', header: 'Access', sortable: true, render: (u) => <Text fontSize="$1" color={u.forbidden ? '$red11' : '$green11'}>{u.forbidden ? 'suspended' : 'active'}</Text> },
  { key: 'lastSignin', header: 'Last sign-in', align: 'right', mono: true, sortable: true, render: (u) => shortDate(u.lastSignin) },
]

const txCols: Column<CustomerDetail['transactions'][number]>[] = [
  { key: 'time', header: 'When', align: 'right', mono: true, sortable: true, render: (t) => shortDate(t.time) },
  { key: 'type', header: 'Type', sortable: true, render: (t) => <Text fontSize="$2" color={t.type === 'deposit' ? '$green11' : '$color11'}>{t.type}</Text> },
  { key: 'cents', header: 'Amount', align: 'right', mono: true, sortable: true, render: (t) => usd(t.cents) },
  { key: 'notes', header: 'Notes', sortable: true, render: (t) => t.notes ?? '' },
]

function CustomerDetailView({ org, onBack }: { org: string; onBack: () => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showCredit, setShowCredit] = useState(false)

  const { data: detail, loading, err, reload } = useAdminResource(
    useCallback(() => AdminCockpitApi.customer(org), [org]),
  )
  const users = useSort('name')
  const txs = useSort('time', 'desc')

  const grant = useCallback(async (input: GrantInput, idempotencyKey: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await AdminCockpitApi.grantCredit(org, input, idempotencyKey)
      setNotice({ ok: true, msg: grantNotice(input.source, res) })
      setShowCredit(false)
      await reload()
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy(false)
    }
  }, [org, reload])

  const toggleSuspend = useCallback(async (suspend: boolean) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = suspend ? await AdminCockpitApi.suspend(org) : await AdminCockpitApi.reactivate(org)
      const failed = res.failed.length ? ` (${res.failed.length} user(s) not updated)` : ''
      setNotice({ ok: res.failed.length === 0, msg: `${suspend ? 'Suspended' : 'Reactivated'} ${res.affected.length} user(s)${failed}` })
      await reload()
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy(false)
    }
  }, [org, reload])

  const back = <Button size="$3" chromeless icon={<ArrowLeft size={16} />} onPress={onBack}>Customers</Button>

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err) return <YStack p="$4" gap="$4">{back}<ErrorState err={err} onRetry={reload} /></YStack>
  if (loading || !detail) return <YStack p="$4" gap="$4">{back}<PageHeader title={org} /><Text color="$color10">Loading…</Text></YStack>

  const d = detail
  const suspended = d.status === 'suspended'

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
        <MetricCard icon={<RefreshCw size={16} />} label="MRR" value={d.mrrCents ? usd(d.mrrCents) : DASH} caption="recurring" />
        <MetricCard icon={<Users size={16} />} label="Users · keys" value={`${d.users.length} · ${d.apiKeys}`} caption="members · API keys" />
      </XStack>

      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Members</Text>
        <DataTable<CustomerDetail['users'][number]>
          columns={userCols}
          rows={users.apply(d.users)}
          empty="No users."
          rowKey={(u) => u.name}
          sort={users.sort}
          onSortChange={users.onSortChange}
        />
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Top-ups & usage</Text>
        {d.transactions.length === 0
          ? <EmptyState icon={CreditCard} title="No transactions yet" description="Deposits and usage appear here as they happen." />
          : <DataTable<CustomerDetail['transactions'][number]>
              columns={txCols}
              rows={txs.apply(d.transactions)}
              rowKey={(t) => t.id || t.time}
              sort={txs.sort}
              onSortChange={txs.onSortChange}
            />}
      </YStack>
    </YStack>
  )
}
