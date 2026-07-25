'use client'

/**
 * admin.hanzo.ai REVENUE board — the fleet money view: total balances held, total
 * realized spend, MRR, ARPU, and the per-customer revenue table with a real spend
 * trend. GLOBAL-ADMIN ONLY (`admin: true`; the `/v1/admin/revenue` aggregate is
 * server-gated). Orthogonal to Finance (COGS/margin) — this is the CUSTOMER money
 * lens (who holds / spends / subscribes). Every number is a real commerce read.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Coins, CreditCard, RefreshCw, TrendingUp, Users } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { AdminCockpitApi, type RevenueCustomer, type RevenueData } from '~/lib/api/admin-cockpit'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { LineChart } from '~/components/ui/Charts'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import { toneVar } from '~/components/ui/tone'

const usd = (cents: number): string => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function RevenueModule() {
  const [data, setData] = useState<RevenueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setData(await AdminCockpitApi.revenue()) } catch (e) { setErr(asApiError(e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Revenue" /><ErrorState err={err} onRetry={load} /></YStack>

  const cols: Column<RevenueCustomer>[] = [
    { key: 'org', header: 'Customer', render: (r) => <YStack><Text fontSize="$3" color="$color12">{r.display}</Text><Text fontSize="$1" color="$color9">{r.plan}</Text></YStack> },
    { key: 'balanceCents', header: 'Balance', render: (r) => <Text fontSize="$2" color="$green11">{usd(r.balanceCents)}</Text> },
    { key: 'spendCents', header: 'Spend', render: (r) => <Text fontSize="$2" color="$color12">{usd(r.spendCents)}</Text> },
    { key: 'mrrCents', header: 'MRR', render: (r) => <Text fontSize="$2" color="$color11">{r.mrrCents ? usd(r.mrrCents) : '—'}</Text> },
  ]

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Revenue"
        subtitle="Balances held, realized spend, MRR, and per-customer revenue across the fleet. Global-admin only."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<CreditCard size={16} />} label="Total balances" value={data ? usd(data.totalBalancesCents) : '—'} caption="prepaid credit held" />
        <MetricCard icon={<Coins size={16} />} label="Total spend" value={data ? usd(data.totalSpendCents) : '—'} caption="realized usage" />
        <MetricCard icon={<TrendingUp size={16} />} label="MRR" value={data ? usd(data.mrrCents) : '—'} caption="recurring" />
        <MetricCard icon={<TrendingUp size={16} />} label="ARPU" value={data ? usd(data.arpuCents) : '—'} caption="per paying customer" />
        <MetricCard icon={<Users size={16} />} label="Customers" value={data ? String(data.customers) : '—'} caption={data ? `${data.payingCustomers} paying` : ''} />
      </XStack>
      <YStack gap="$2">
        <Text fontSize="$4" color="$color12">Fleet spend (30 days)</Text>
        {data ? <LineChart data={data.spendTrend.map((p) => ({ label: p.t, value: p.value }))} color={toneVar('positive')} formatValue={(v) => usd(v)} /> : <Text color="$color10">Loading…</Text>}
      </YStack>
      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Per-customer revenue</Text>
        <DataTable<RevenueCustomer> columns={cols} rows={data?.perCustomer ?? []} loading={loading} empty="No customers yet." rowKey={(r) => r.org} />
      </YStack>
    </YStack>
  )
}
