'use client'

/**
 * admin.hanzo.ai ANALYTICS board — native SaaS analytics: cohort retention, growth,
 * churn, active customers (DAU/WAU/MAU), revenue/ARPU, and usage over time.
 *
 * GLOBAL-ADMIN ONLY (`admin: true`; the `/v1/admin/analytics` aggregate is server-
 * gated by `getAdminGate`). Every metric is REAL — signup cohorts from IAM
 * createdTime, activity from the commerce usage ledger. HONEST BY CONSTRUCTION: the
 * backend returns a `computed` map flagging which metrics are backed by data; where a
 * metric is not yet computable (no ledger, no observed churn) this board renders an
 * honest "not enough data yet" state and NEVER a fabricated curve. The retention
 * heatmap shows real cohort × period percentages or honest zeros — never an invented
 * triangle.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, RefreshCw, TrendingUp, UserPlus, Users } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { AdminCockpitApi, type AnalyticsData } from '~/lib/api/admin-cockpit'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { LineChart, BarChart, type ChartPoint } from '~/components/ui/Charts'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import { toneVar } from '~/components/ui/tone'

type Range = '7d' | '30d' | '90d' | 'all'
const RANGES: { key: Range; label: string }[] = [
  { key: '7d', label: '7D' }, { key: '30d', label: '30D' }, { key: '90d', label: '90D' }, { key: 'all', label: 'All' },
]
const usd = (cents: number): string => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pts = (s: { t: string; value: number }[]): ChartPoint[] => s.map((p) => ({ label: p.t, value: p.value }))

/** An honest "computed[x] is false" panel — never a fabricated chart. */
function NotEnough({ title, why }: { title: string; why: string }) {
  return (
    <YStack p="$4" gap="$1" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2" items="center" justify="center" minH={120}>
      <Text fontSize="$3" color="$color11">{title}</Text>
      <Text fontSize="$1" color="$color9">{why}</Text>
    </YStack>
  )
}

/** Cohort-retention heatmap — real cohort × period percentages, color by intensity. */
function RetentionHeatmap({ data }: { data: AnalyticsData['retention'] }) {
  if (data.cohorts.length === 0) return <NotEnough title="No cohorts yet" why="Retention appears once customers sign up and start using the platform." />
  const cols = data.periods
  const cell = (v: number) => {
    // Retention reads as INK DENSITY, not hue: faint at 0%, solid at 100%.
    const a = Math.max(0.06, Math.min(1, v / 100))
    return `rgba(220,220,220,${a})`
  }
  return (
    <YStack gap="$2" style={{ overflowX: 'auto' }}>
      <XStack gap="$1" items="center">
        <YStack width={140} />
        {Array.from({ length: cols }).map((_, k) => (
          <YStack key={k} width={44} items="center"><Text fontSize="$1" color="$color9">M{k}</Text></YStack>
        ))}
      </XStack>
      {data.cohorts.map((c) => (
        <XStack key={c.cohort} gap="$1" items="center">
          <YStack width={140}>
            <Text fontSize="$2" color="$color12">{c.cohort}</Text>
            <Text fontSize="$1" color="$color9">{c.size} signup{c.size === 1 ? '' : 's'}</Text>
          </YStack>
          {Array.from({ length: cols }).map((_, k) => {
            const v = c.values[k]
            const has = typeof v === 'number' && k < c.values.length
            return (
              <YStack key={k} width={44} height={36} rounded="$2" items="center" justify="center"
                bg={has ? undefined : 'transparent'}
                style={has ? { background: cell(v) } : undefined}>
                {has && <Text fontSize="$1" color={v >= 55 ? '$color1' : '$color11'}>{Math.round(v)}%</Text>}
              </YStack>
            )
          })}
        </XStack>
      ))}
    </YStack>
  )
}

export function AnalyticsModule() {
  const [range, setRange] = useState<Range>('30d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setData(await AdminCockpitApi.analytics(range)) } catch (e) { setErr(asApiError(e)) } finally { setLoading(false) }
  }, [range])

  useEffect(() => { void load() }, [load])

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Analytics" /><ErrorState err={err} onRetry={load} /></YStack>

  const c = data?.computed ?? {}
  const rangeToggle = (
    <XStack gap="$1" bg="$color3" rounded="$4" p="$1">
      {RANGES.map((r) => (
        <Button key={r.key} size="$2" chromeless={range !== r.key} onPress={() => setRange(r.key)}>{r.label}</Button>
      ))}
    </XStack>
  )

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Analytics"
        subtitle="Cohort retention, growth, churn, and revenue across the whole customer base. Global-admin only."
        actions={<XStack gap="$2" items="center">{rangeToggle}<Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button></XStack>}
      />

      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Users size={16} />} label="Customers" value={data ? String(data.totalCustomers) : '—'} caption="all-time" />
        <MetricCard icon={<UserPlus size={16} />} label="New" value={data ? String(data.newCustomers) : '—'} caption={data ? `this ${range} · ${data.growthRatePct >= 0 ? '+' : ''}${data.growthRatePct.toFixed(0)}% vs prior` : `this ${range}`} />
        <MetricCard icon={<Activity size={16} />} label="Active (MAU)" value={data && c.active ? String(data.mau) : '—'} caption={data && c.active ? `DAU ${data.dau} · WAU ${data.wau}` : 'needs usage data'} />
        <MetricCard icon={<TrendingUp size={16} />} label="MRR" value={data ? usd(data.mrrCents) : '—'} caption="recurring" />
        <MetricCard icon={<TrendingUp size={16} />} label="ARPU" value={data && c.arpu ? usd(data.arpuCents) : '—'} caption={data && c.arpu ? 'per active customer' : 'needs usage data'} />
        <MetricCard icon={<TrendingUp size={16} />} label="Churn" value={data && c.churn ? `${data.churnRatePct.toFixed(1)}%` : '—'} caption={data && c.churn ? 'monthly logo churn' : 'needs usage history'} />
      </XStack>

      {/* HEADLINE: cohort retention heatmap */}
      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Cohort retention</Text>
        <Text fontSize="$1" color="$color10">% of each signup cohort still active (used the platform) in each subsequent month.</Text>
        {data ? (c.retention ? <RetentionHeatmap data={data.retention} /> : <NotEnough title="Retention needs usage data" why="Cohorts (from signups) exist, but no usage has been recorded yet to measure retention." />) : <Text color="$color10">Loading…</Text>}
      </YStack>

      <XStack gap="$4" flexWrap="wrap">
        <YStack gap="$2" flex={1} minW={320}>
          <Text fontSize="$4" color="$color12">New signups over time</Text>
          {data ? <BarChart data={pts(data.signups)} /> : <Text color="$color10">Loading…</Text>}
        </YStack>
        <YStack gap="$2" flex={1} minW={320}>
          <Text fontSize="$4" color="$color12">Active customers</Text>
          {data ? (c.active ? <LineChart data={pts(data.activeCustomers)} /> : <NotEnough title="No activity yet" why="Active-customer counts appear once usage is recorded." />) : <Text color="$color10">Loading…</Text>}
        </YStack>
      </XStack>

      <XStack gap="$4" flexWrap="wrap">
        <YStack gap="$2" flex={1} minW={320}>
          <Text fontSize="$4" color="$color12">Usage / revenue over time</Text>
          {data ? (c.usage ? <LineChart data={pts(data.usage)} color={toneVar('positive')} formatValue={(v) => usd(v)} /> : <NotEnough title="No usage yet" why="Fleet usage revenue appears as customers consume." />) : <Text color="$color10">Loading…</Text>}
        </YStack>
        <YStack gap="$2" flex={1} minW={320}>
          <Text fontSize="$4" color="$color12">Top customers by usage</Text>
          {data && data.topCustomers.length > 0 ? <BarChart data={data.topCustomers.map((t) => ({ label: t.hint || t.label, value: t.value }))} color={toneVar('positive')} formatValue={(v) => usd(v)} /> : <NotEnough title="No usage attributed yet" why="Top customers appear once usage is recorded." />}
        </YStack>
      </XStack>

      <XStack gap="$3" flexWrap="wrap">
        <Text fontSize="$1" color="$color9">LTV: {data && data.ltvCents != null ? usd(data.ltvCents) : '— (needs observed churn)'}</Text>
        <Text fontSize="$1" color="$color9">· NRR: {data && data.nrrPct != null ? `${data.nrrPct.toFixed(0)}%` : '— (needs MRR history)'}</Text>
      </XStack>
    </YStack>
  )
}
