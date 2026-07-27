'use client'

/**
 * Money — the ONE consolidated financial view. GLOBAL-ADMIN only.
 *
 * Revenue, credits granted vs consumed, spend by org, outstanding balance and
 * infrastructure cost, on one page. Cloud folds it server-side from the same functions
 * /revenue, /finance and /grants use, so nothing here re-derives a number that another
 * board also reports — this renders what it is given.
 *
 * Money is integer USD cents all the way to `usd()`; no float ever holds an amount.
 */
import { useMemo, useState } from 'react'
import { Text, XStack, YStack, Button } from '@hanzo/gui'
import { Banknote, Coins, Gift, RefreshCw, Server, TrendingUp } from '@hanzogui/lucide-icons-2'

import { AdminMoneyApi, type MoneyOrg } from '~/lib/api/admin-money'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { SearchInput } from '~/components/ui/Filters'
import { MetricCard, Panel } from '~/components/ui/Metric'
import { PageHeader } from '~/components/ui/PageHeader'
import { ErrorState, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import { useAdminResource } from '~/lib/hooks/useAdminResource'
import { searchRows, useSort } from '~/lib/table'
import { DASH, int, pct, usd } from '~/lib/format'

/** One labelled cents figure in a Panel — the repeated shape on this page. */
function Line({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <XStack justify="space-between" items="baseline" gap="$3">
      <YStack>
        <Text fontSize="$2" color="$color10">
          {label}
        </Text>
        {hint ? (
          <Text fontSize="$1" color="$color9">
            {hint}
          </Text>
        ) : null}
      </YStack>
      <Text fontSize="$4" color="$color12" className="hz-mono">
        {usd(cents)}
      </Text>
    </XStack>
  )
}

export function MoneyModule() {
  const { data, loading, err, reload } = useAdminResource(useMemo(() => () => AdminMoneyApi.board(), []))
  const [q, setQ] = useState('')
  const { sort, onSortChange, apply } = useSort('spendCents', 'desc')

  const rows = useMemo(
    () => apply(searchRows(data?.byOrg ?? [], q, (o) => `${o.org} ${o.display} ${o.plan}`)),
    [data?.byOrg, q, apply],
  )

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err)
    return (
      <YStack p="$4" gap="$4">
        <PageHeader title="Money" />
        <ErrorState err={err} onRetry={reload} />
      </YStack>
    )

  const rev = data?.revenue
  const cr = data?.credits
  const inf = data?.infrastructure
  const mg = data?.margin

  const columns: Column<MoneyOrg>[] = [
    {
      key: 'display',
      header: 'Customer',
      sortable: true,
      render: (o) => (
        <YStack>
          <Text fontSize="$3" color="$color12" numberOfLines={1}>
            {o.display}
          </Text>
          <Text fontSize="$1" color="$color9" className="hz-mono" numberOfLines={1}>
            {o.org}
          </Text>
        </YStack>
      ),
    },
    { key: 'plan', header: 'Plan', width: 130, sortable: true, render: (o) => o.plan || DASH },
    { key: 'spendCents', header: 'Spent', width: 110, align: 'right', mono: true, sortable: true, render: (o) => usd(o.spendCents) },
    { key: 'grantedCents', header: 'Granted', width: 110, align: 'right', mono: true, sortable: true, render: (o) => (o.grants ? usd(o.grantedCents) : DASH) },
    { key: 'balanceCents', header: 'Outstanding', width: 120, align: 'right', mono: true, sortable: true, render: (o) => usd(o.balanceCents) },
    { key: 'mrrCents', header: 'MRR', width: 100, align: 'right', mono: true, sortable: true, render: (o) => (o.mrrCents ? usd(o.mrrCents) : DASH) },
  ]

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Money"
        subtitle="Revenue, credits, spend by customer, and what the platform costs to run — one consolidated view."
        actions={<Button size="$2" chromeless icon={<RefreshCw size={15} />} onPress={() => void reload()} aria-label="Refresh" />}
      />

      <XStack flexWrap="wrap" gap="$3">
        <MetricCard icon={<Banknote size={16} />} label="Realized revenue" value={usd(rev?.realizedCents ?? 0)} caption={`${int(rev?.paying ?? 0)} of ${int(rev?.customers ?? 0)} paying`} />
        <MetricCard icon={<TrendingUp size={16} />} label="MRR" value={usd(rev?.mrrCents ?? 0)} caption={`${usd(rev?.arrCents ?? 0)} ARR`} />
        <MetricCard icon={<Coins size={16} />} label="Outstanding credit" value={usd(cr?.outstandingCents ?? 0)} caption="held by customers" />
        <MetricCard icon={<Server size={16} />} label="Infra cost" value={usd((inf?.vendorCogsCents ?? 0) + (inf?.doMonthToDateCents ?? 0))} caption={inf?.period || DASH} />
        <MetricCard
          icon={<TrendingUp size={16} />}
          label="Gross margin"
          value={usd(mg?.grossCents ?? 0)}
          caption={mg ? `${pct(mg.grossPct)}${mg.runwayDays != null ? ` · ${Math.round(mg.runwayDays)}d runway` : ''}` : DASH}
        />
      </XStack>

      <XStack flexWrap="wrap" gap="$3">
        <Panel title="Credits">
          <YStack gap="$2.5">
            <Line label="Granted" cents={cr?.grantedCents ?? 0} hint={`${int(cr?.grants ?? 0)} grants`} />
            <Line label="— prepaid" cents={cr?.grantedPrepaidCents ?? 0} hint="real money added" />
            <Line label="— trial" cents={cr?.grantedTrialCents ?? 0} hint="non-cash comps" />
            <Line label="Consumed" cents={cr?.consumedCents ?? 0} hint="spent by customers" />
            <Line label="Outstanding" cents={cr?.outstandingCents ?? 0} hint="still held (liability)" />
          </YStack>
        </Panel>

        <Panel title="Infrastructure">
          <YStack gap="$2.5">
            <Line label="Vendor COGS" cents={inf?.vendorCogsCents ?? 0} hint={inf?.period} />
            <Line label="DigitalOcean month-to-date" cents={inf?.doMonthToDateCents ?? 0} />
            <Line label="DigitalOcean credit left" cents={inf?.doCreditRemainingCents ?? 0} hint={`${usd(inf?.doAvgDailyBurnCents ?? 0)}/day burn`} />
            <Line label="Treasury reserve" cents={inf?.treasuryReserveCents ?? 0} hint="backs payout programs" />
          </YStack>
        </Panel>
      </XStack>

      <XStack gap="$2" items="center">
        <SearchInput value={q} onChange={setQ} placeholder="Search customers…" />
      </XStack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(o) => o.org}
        sort={sort}
        onSortChange={onSortChange}
        dense
        empty={q ? 'No customers match this filter.' : 'No customers yet.'}
      />
    </YStack>
  )
}
