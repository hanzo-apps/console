'use client'

/**
 * admin.hanzo.ai GRANTS board — the fleet credit-grant ledger + issuance. Every
 * comp/welcome/starter credit granted across the platform, who issued it, and a form
 * to issue a new one. GLOBAL-ADMIN ONLY (`admin: true` hides it from every customer;
 * the `/v1/admin/grants` aggregate is server-gated by `getAdminGate`). Real commerce
 * data; the `source` bucket is Trial (non-cash comp) or Prepaid (real money).
 */
import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Coins, Gift, RefreshCw } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { AdminGrantsApi, type AdminGrant, type GrantSource } from '~/lib/api/admin-grants'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired } from '~/components/ui/States'

const usd = (cents: number): string => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const shortDate = (s: string): string => (s ? (s.split('T')[0] ?? s) : '—')

const INPUT_BASE: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--borderColor)',
  borderRadius: 8,
  padding: '8px 10px',
  color: 'var(--color12)',
}

/** Trial vs Prepaid pill — trial is the non-cash comp bucket, prepaid is real money. */
function SourceBadge({ source }: { source: GrantSource }) {
  const trial = source === 'trial'
  return (
    <XStack items="center" px="$2" py="$1" rounded="$3" bg={trial ? '$color3' : '$green3'}>
      <Text fontSize="$1" color={trial ? '$color12' : '$green11'}>{trial ? 'Trial' : 'Prepaid'}</Text>
    </XStack>
  )
}

/** The "issue a new grant" form — org + amount + source toggle + reason → POST. */
function NewGrantForm({ busy, onIssue }: { busy: boolean; onIssue: (org: string, amountCents: number, source: GrantSource, reason?: string) => void }) {
  const [org, setOrg] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [source, setSource] = useState<GrantSource>('trial')
  const [localErr, setLocalErr] = useState<string | null>(null)

  const submit = () => {
    const slug = org.trim()
    const dollars = parseFloat(amount)
    if (!slug) { setLocalErr('Enter the org slug.'); return }
    if (!Number.isFinite(dollars) || dollars <= 0) { setLocalErr('Enter a positive amount.'); return }
    setLocalErr(null)
    onIssue(slug, Math.round(dollars * 100), source, reason.trim() || undefined)
  }

  return (
    <YStack p="$4" gap="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <Text fontSize="$4" color="$color12">Issue a grant</Text>
      <Text fontSize="$1" color="$color10">
        A real commerce deposit into an org’s wallet. Trial = non-cash comp; Prepaid = real money. Audited to you.
      </Text>
      <YStack gap="$1">
        <Text fontSize="$1" color="$color10">Source</Text>
        <XStack gap="$2">
          {(['trial', 'prepaid'] as const).map((s) => (
            <Button key={s} size="$2" bg={source === s ? '$color5' : 'transparent'} borderWidth={1} borderColor="$borderColor" disabled={busy} onPress={() => setSource(s)}>
              {s === 'trial' ? 'Trial credit' : 'Prepaid'}
            </Button>
          ))}
        </XStack>
      </YStack>
      <XStack gap="$3" items="flex-end" flexWrap="wrap">
        <YStack gap="$1">
          <Text fontSize="$1" color="$color10">Org slug</Text>
          <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="acme" style={{ ...INPUT_BASE, width: 180 }} />
        </YStack>
        <YStack gap="$1">
          <Text fontSize="$1" color="$color10">Amount (USD)</Text>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" inputMode="decimal" style={{ ...INPUT_BASE, width: 120 }} />
        </YStack>
        <YStack gap="$1" flex={1} minW={200}>
          <Text fontSize="$1" color="$color10">Reason</Text>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="welcome comp" style={{ ...INPUT_BASE, width: '100%' }} />
        </YStack>
        <Button size="$3" icon={<Gift size={15} />} disabled={busy} onPress={submit}>{busy ? 'Issuing…' : 'Issue grant'}</Button>
      </XStack>
      {localErr ? <Text fontSize="$2" color="$red11">{localErr}</Text> : null}
    </YStack>
  )
}

export function GrantsModule() {
  const [rows, setRows] = useState<AdminGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setRows(await AdminGrantsApi.list())
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const issue = useCallback(async (org: string, amountCents: number, source: GrantSource, reason?: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const g = await AdminGrantsApi.create({ org, amountCents, source, reason })
      setNotice({ ok: true, msg: `Granted ${usd(g.amountCents)} ${g.source} to ${g.orgDisplay || g.org}${g.transactionId ? ` · tx ${g.transactionId}` : ''}` })
      await load()
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy(false)
    }
  }, [load])

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Grants" /><ErrorState err={err} onRetry={load} /></YStack>

  const total = rows.reduce((s, r) => s + r.amountCents, 0)
  const trial = rows.filter((r) => r.source === 'trial').reduce((s, r) => s + r.amountCents, 0)
  const prepaid = total - trial

  const columns: Column<AdminGrant>[] = [
    { key: 'org', header: 'Org', render: (r) => (
      <YStack><Text fontSize="$3" color="$color12">{r.orgDisplay || r.org}</Text>{r.orgDisplay && r.org !== r.orgDisplay ? <Text fontSize="$1" color="$color10">{r.org}</Text> : null}</YStack>
    ) },
    { key: 'amountCents', header: 'Amount', align: 'right', render: (r) => <Text fontSize="$2" color="$green11" className="hz-mono">{usd(r.amountCents)}</Text> },
    { key: 'source', header: 'Source', width: 92, render: (r) => <SourceBadge source={r.source} /> },
    { key: 'reason', header: 'Reason', render: (r) => <Text fontSize="$2" color="$color11">{r.reason || '—'}</Text> },
    { key: 'actor', header: 'Issued by', render: (r) => <Text fontSize="$1" color="$color10">{r.actor || '—'}</Text> },
    { key: 'createdAt', header: 'Date', width: 110, render: (r) => <Text fontSize="$1" color="$color10">{shortDate(r.createdAt)}</Text> },
  ]

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Grants"
        subtitle="Every credit grant issued across the platform — comps, welcome/starter, support. Global-admin only."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Coins size={16} />} label="Total granted" value={usd(total)} caption={`${rows.length} grants`} />
        <MetricCard icon={<Gift size={16} />} label="Trial credit" value={usd(trial)} caption="non-cash comp" />
        <MetricCard icon={<Coins size={16} />} label="Prepaid" value={usd(prepaid)} caption="real money" />
      </XStack>

      {notice && (
        <XStack p="$3" rounded="$4" bg={notice.ok ? '$green3' : '$red3'}>
          <Text fontSize="$2" color={notice.ok ? '$green11' : '$red11'}>{notice.msg}</Text>
        </XStack>
      )}

      <NewGrantForm busy={busy} onIssue={issue} />

      <DataTable<AdminGrant>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="No grants issued yet."
        rowKey={(r) => r.transactionId || `${r.org}-${r.createdAt}`}
      />
    </YStack>
  )
}
