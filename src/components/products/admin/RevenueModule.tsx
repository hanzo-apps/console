'use client'

/**
 * admin.hanzo.ai REVENUE board — the fleet money view: total balances held, total
 * realized spend, MRR, ARPU, and the per-customer revenue table with a real spend
 * trend. GLOBAL-ADMIN ONLY (`admin: true`; the `/v1/admin/revenue` aggregate is
 * server-gated). Orthogonal to Finance (COGS/margin) — this is the CUSTOMER money
 * lens (who holds / spends / subscribes). Every number is a real commerce read.
 */
import { useCallback, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Coins, CreditCard, RefreshCw, TrendingUp, Users } from '@hanzogui/lucide-icons-2'

import { AdminCockpitApi, type RevenueCustomer } from '~/lib/api/admin-cockpit'
import { DASH, usd } from '~/lib/format'
import { searchRows, useSort } from '~/lib/table'
import { useAdminResource } from '~/lib/hooks/useAdminResource'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { SearchInput } from '~/components/ui/Filters'
import { LineChart } from '~/components/ui/Charts'
import { ErrorState, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import { toneVar } from '~/components/ui/tone'

const cols: Column<RevenueCustomer>[] = [
  // Sorts on `display` — the field the cell SHOWS. `org` is the row key, not the label.
  { key: 'display', header: 'Customer', sortable: true, render: (r) => <YStack><Text fontSize="$3" color="$color12">{r.display}</Text><Text fontSize="$1" color="$color9">{r.plan}</Text></YStack> },
  { key: 'balanceCents', header: 'Balance', align: 'right', mono: true, sortable: true, render: (r) => usd(r.balanceCents) },
  { key: 'spendCents', header: 'Spend', align: 'right', mono: true, sortable: true, render: (r) => usd(r.spendCents) },
  { key: 'mrrCents', header: 'MRR', align: 'right', mono: true, sortable: true, render: (r) => (r.mrrCents ? usd(r.mrrCents) : DASH) },
]

export function RevenueModule() {
  const [q, setQ] = useState('')
  const { data, loading, err, reload } = useAdminResource(useCallback(() => AdminCockpitApi.revenue(), []))
  const { sort, onSortChange, apply } = useSort('spendCents', 'desc')

  const rows = useMemo(
    () => apply(searchRows(data?.perCustomer ?? [], q, (r) => `${r.display} ${r.org} ${r.plan}`)),
    [data, q, apply],
  )

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Revenue" /><ErrorState err={err} onRetry={reload} /></YStack>

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Revenue"
        subtitle="Balances held, realized spend, MRR, and per-customer revenue across the fleet. Global-admin only."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={reload}>Refresh</Button>}
      />
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<CreditCard size={16} />} label="Total balances" value={usd(data?.totalBalancesCents)} caption="prepaid credit held" />
        <MetricCard icon={<Coins size={16} />} label="Total spend" value={usd(data?.totalSpendCents)} caption="realized usage" />
        <MetricCard icon={<TrendingUp size={16} />} label="MRR" value={usd(data?.mrrCents)} caption="recurring" />
        <MetricCard icon={<TrendingUp size={16} />} label="ARPU" value={usd(data?.arpuCents)} caption="per paying customer" />
        <MetricCard icon={<Users size={16} />} label="Customers" value={data ? String(data.customers) : DASH} caption={data ? `${data.payingCustomers} paying` : ''} />
      </XStack>
      <YStack gap="$2">
        <Text fontSize="$4" color="$color12">Fleet spend (30 days)</Text>
        {data ? <LineChart data={data.spendTrend.map((p) => ({ label: p.t, value: p.value }))} color={toneVar('positive')} formatValue={(v) => usd(v)} /> : <Text color="$color10">Loading…</Text>}
      </YStack>
      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Per-customer revenue</Text>
        <SearchInput value={q} onChange={setQ} placeholder="Search customers, orgs, plans…" />
        <DataTable<RevenueCustomer>
          columns={cols}
          rows={rows}
          loading={loading}
          empty={q ? 'No customers match.' : 'No customers yet.'}
          rowKey={(r) => r.org}
          sort={sort}
          onSortChange={onSortChange}
        />
      </YStack>
    </YStack>
  )
}
