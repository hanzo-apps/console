'use client'

/**
 * Usage — the org's UNIFIED footprint: one screen answering "what am I running and
 * what does it cost". The KPI band + cost roll-up (spend by category over time +
 * wallet) + LLM usage totals come from ONE authoritative endpoint
 * (`GET /v1/usage/summary`, cloud `clients/usage`), which composes the commerce
 * ledger + the warehouse server-side. The compute footprint (machines / GPUs) is
 * read from the existing org-scoped inventory endpoint, best-effort.
 *
 * REAL data only, honest by construction: each source degrades independently to
 * zeros with a "not connected" badge (never a fabricated figure), and the whole
 * table is one-click CSV-exportable for a finance/compliance review.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Download, DollarSign, Wallet, CalendarDays, Hash, Activity, Server, Cpu } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { BarChart, Donut, type ChartPoint, type Slice } from '~/components/ui/Charts'
import { RAMP, OTHER } from '~/lib/theme/ramp'
import { MetricCard, Panel, LegendDot } from '~/components/ui/Metric'
import { RangeTabs } from '~/components/products/billing/RangeTabs'
import type { RangeKey } from '~/lib/api/aimetrics'
import { UsageSummaryApi, type UsageSummary, type CategorySpend } from '~/lib/api/usage-summary'
import { VisorApi, type VisorMachine } from '~/lib/api/visor'
import { exportCSV } from '~/lib/csv'
import { toneColor, toneVar } from '~/components/ui/tone'

const usd = (cents: number): string => {
  const d = cents / 100
  if (Math.abs(d) >= 10000) return `$${(d / 1000).toFixed(1)}K`
  return `$${d.toFixed(2)}`
}
const compact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

/** Format a bucket timestamp for the spend chart: "Jul 3" for day buckets, "14:00"
 *  for hour buckets. A drift-tolerant parse degrades to the raw string. */
const fmtBucket = (iso: string, interval: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  if (interval === 'hour') return `${String(d.getUTCHours()).padStart(2, '0')}:00`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const isRunning = (m: VisorMachine): boolean => {
  const s = (m.status ?? '').toLowerCase()
  return s === 'active' || s === 'running'
}

export function UsageModule(_props: { params: Record<string, string> }) {
  const [range, setRange] = useState<RangeKey>('7d')
  const [summary, setSummary] = useState<Async<UsageSummary>>({ phase: 'loading' })
  // Compute inventory is range-independent (a live snapshot) and best-effort — a
  // visor blip never blocks the cost roll-up; the board just shows "—".
  const [machines, setMachines] = useState<VisorMachine[] | null>(null)

  const loadSummary = useCallback((r: RangeKey) => {
    setSummary({ phase: 'loading' })
    UsageSummaryApi.summary(r)
      .then((data) => setSummary({ phase: 'ready', data }))
      .catch((e) => setSummary({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  const loadInventory = useCallback(() => {
    VisorApi.machines()
      .then(setMachines)
      .catch(() => setMachines(null))
  }, [])

  useEffect(() => {
    loadSummary(range)
  }, [loadSummary, range])
  useEffect(() => {
    loadInventory()
  }, [loadInventory])

  const data = summary.phase === 'ready' ? summary.data : null
  const spend = data?.spend
  const llm = data?.llm

  // ── derived views ──────────────────────────────────────────────────────────
  const spendSeries: ChartPoint[] = useMemo(
    () => (spend?.series ?? []).map((p) => ({ label: fmtBucket(p.t, data?.interval ?? 'day'), value: p.cents / 100 })),
    [spend, data?.interval],
  )
  const totalByCategory = useMemo(() => (spend?.byCategory ?? []).reduce((a, c) => a + c.cents, 0), [spend])
  const categorySlices: Slice[] = useMemo(() => {
    const cats = spend?.byCategory ?? []
    const top = cats.slice(0, 7).map((c, i): Slice => ({ label: c.category, value: c.cents, color: RAMP[i % RAMP.length] }))
    const rest = cats.slice(7)
    if (rest.length) top.push({ label: `Other (${rest.length})`, value: rest.reduce((a, c) => a + c.cents, 0), color: OTHER })
    return top
  }, [spend])

  const machineCount = machines?.length ?? null
  const gpuCount = machines ? machines.filter((m) => (m.gpu ?? '').trim() !== '').length : null
  const runningCount = machines ? machines.filter(isRunning).length : null

  const categoryColumns: Column<CategorySpend>[] = [
    { key: 'category', header: 'Category', render: (c) => <Text fontSize="$3" fontWeight="600" color="$color12">{c.category}</Text> },
    { key: 'count', header: 'Lines', width: 110, align: 'right', mono: true, render: (c) => <Text fontSize="$3" color="$color11">{c.count.toLocaleString()}</Text> },
    {
      key: 'cents', header: 'Cost', width: 140, align: 'right', mono: true,
      render: (c) => (
        <YStack items="flex-end">
          <Text fontSize="$3" color="$color12">{usd(c.cents)}</Text>
          {totalByCategory > 0 ? <Text fontSize="$1" color="$color10">{Math.round((c.cents / totalByCategory) * 100)}%</Text> : null}
        </YStack>
      ),
    },
  ]

  const onExport = useCallback(() => {
    if (!data) return
    const rows = (data.spend.byCategory ?? []).map((c) => [c.category, c.count, (c.cents / 100).toFixed(2), totalByCategory > 0 ? `${Math.round((c.cents / totalByCategory) * 100)}%` : '0%'])
    // Trailing summary rows: totals + wallet, so the export stands alone as a receipt.
    rows.push(['', '', '', ''])
    rows.push(['Total (window)', '', (data.spend.totalCents / 100).toFixed(2), ''])
    rows.push(['Month-to-date', '', (data.spend.mtdCents / 100).toFixed(2), ''])
    rows.push(['Prepaid available', '', (data.spend.availableCents / 100).toFixed(2), ''])
    rows.push(['LLM tokens', String(data.llm.tokens), '', ''])
    rows.push(['LLM spend', '', (data.llm.costCents / 100).toFixed(2), ''])
    exportCSV(`usage-${data.org || 'org'}-${data.range}`, ['Category', 'Lines', 'Cost (USD)', 'Share'], rows)
  }, [data, totalByCategory])

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="Your organization's total footprint — spend by category, LLM usage, and compute — over a selectable range. One authoritative source; honest zeros where a source isn't connected."
        actions={
          <XStack gap="$2" items="center">
            <RangeTabs value={range} onChange={setRange} />
            <Button size="$2" icon={<Download size={15} />} onPress={onExport} disabled={!data} aria-label="Export usage CSV">
              Export
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => { loadSummary(range); loadInventory() }}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {summary.phase === 'error' ? (
        <BackendStateCard state={summary.error} onRetry={() => loadSummary(range)} hint="endpoint · GET /v1/usage/summary" />
      ) : (
        <>
          {/* ── KPI band ──────────────────────────────────────────────────── */}
          <XStack flexWrap="wrap" gap="$3">
            <MetricCard icon={<DollarSign size={16} color={toneColor('positive')} />} label="Spend (period)" value={spend ? usd(spend.totalCents) : '—'} caption={spend?.available ? 'metered consumption' : 'billing not connected'} spark={spend?.series?.map((p) => p.cents)} sparkColor={toneVar('positive')} />
            <MetricCard icon={<CalendarDays size={16} color={toneColor('neutral')} />} label="Month-to-date" value={spend?.available ? usd(spend.mtdCents) : '—'} caption="all products" />
            <MetricCard icon={<Wallet size={16} color={toneColor('neutral')} />} label="Prepaid balance" value={spend?.available ? usd(spend.availableCents) : '—'} caption="available credit" />
            <MetricCard icon={<Hash size={16} color={toneColor('warning')} />} label="LLM tokens" value={llm?.available ? compact(llm.tokens) : '—'} caption={llm?.available ? `${compact(llm.requests)} requests` : 'warehouse not connected'} />
            <MetricCard icon={<Activity size={16} color={toneColor('neutral')} />} label="LLM spend" value={llm?.available ? usd(llm.costCents) : '—'} caption={llm?.available ? `${llm.models} models` : undefined} />
            <MetricCard icon={<Server size={16} color={toneColor('neutral')} />} label="Machines" value={machineCount != null ? String(machineCount) : '—'} caption={runningCount != null ? `${runningCount} running` : 'inventory unavailable'} />
            <MetricCard icon={<Cpu size={16} color={toneColor('neutral')} />} label="GPUs" value={gpuCount != null ? String(gpuCount) : '—'} caption="accelerated machines" />
          </XStack>

          {/* ── Cost roll-up ──────────────────────────────────────────────── */}
          <XStack flexWrap="wrap" gap="$3">
            <Panel title="Spend over time" minW={340}>
              {summary.phase === 'loading' ? (
                <Text fontSize="$3" color="$color11">Loading…</Text>
              ) : spendSeries.length ? (
                <BarChart data={spendSeries} formatValue={(v) => `$${v.toFixed(2)}`} />
              ) : (
                <Text fontSize="$3" color="$color10">{spend?.available ? 'No metered spend in this range yet.' : 'Billing is not connected for this deployment.'}</Text>
              )}
            </Panel>
            <Panel title="Spend by category" minW={280} grow={false}>
              {categorySlices.length ? (
                <YStack items="center" gap="$3">
                  <Donut
                    slices={categorySlices}
                    center={
                      <YStack items="center">
                        <Text fontSize="$6" fontWeight="900">{usd(totalByCategory)}</Text>
                        <Text fontSize="$1" color="$color10">total</Text>
                      </YStack>
                    }
                  />
                  <YStack gap="$1" self="stretch">
                    {categorySlices.map((s) => (
                      <LegendDot key={s.label} color={s.color ?? OTHER} label={s.label} value={usd(s.value)} />
                    ))}
                  </YStack>
                </YStack>
              ) : (
                <Text fontSize="$3" color="$color10">{spend?.available ? 'No categorized spend yet.' : 'Billing not connected.'}</Text>
              )}
            </Panel>
          </XStack>

          {/* ── Category line items (CSV-exportable) ──────────────────────── */}
          <YStack gap="$2">
            <XStack items="center" justify="space-between" gap="$2">
              <Text fontSize="$4" fontWeight="800" color="$color12">Cost breakdown</Text>
              <Button size="$2" chromeless icon={<Download size={14} />} onPress={onExport} disabled={!data}>
                Export CSV
              </Button>
            </XStack>
            <DataTable
              columns={categoryColumns}
              rows={spend?.byCategory ?? []}
              loading={summary.phase === 'loading'}
              rowKey={(c) => c.category}
              empty={spend?.available ? 'No metered spend in this range yet.' : 'Billing is not connected for this deployment.'}
            />
          </YStack>

          {/* ── Source honesty footer ─────────────────────────────────────── */}
          {data ? (
            <XStack flexWrap="wrap" gap="$3" py="$1">
              <SourceBadge label="Spend · commerce ledger" ok={data.sources.commerce} />
              <SourceBadge label="LLM · usage warehouse" ok={data.sources.warehouse} />
              <SourceBadge label="Compute · visor inventory" ok={machines != null} />
            </XStack>
          ) : null}
        </>
      )}
    </>
  )
}

/** A small honest connectivity chip for a data source (connected vs not connected). */
function SourceBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <XStack items="center" gap="$1.5" px="$2.5" py="$1" rounded="$10" bg="$color2" borderWidth={1} borderColor="$borderColor">
      <YStack width={7} height={7} rounded="$10" bg={ok ? toneColor('positive') : '$color8'} />
      <Text fontSize="$1" color="$color11">{label}</Text>
      <Text fontSize="$1" color={ok ? toneColor('positive') : '$color9'}>{ok ? 'connected' : 'not connected'}</Text>
    </XStack>
  )
}

