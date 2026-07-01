'use client'

/**
 * Cost reports — the GCP "Cost table / Reports" surface: spend grouped by a real
 * ledger dimension (model, and provider when the ledger carries it — NO invented
 * project/SKU column), a filterable cost table, a daily-spend bar chart, and a
 * spend-share donut, all over a selectable range.
 *
 * REAL data only: the commerce usage ledger (`GET /v1/billing/usage` via the
 * per-tenant `/billing` proxy), windowed + grouped by the pure `withinRange` /
 * `groupSpend` / `dailySpend`. A load failure degrades to an honest notice; an
 * absent dimension is simply not offered — nothing is fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Search, X } from '@hanzogui/lucide-icons-2'

import { fetchUsageRecords, withinRange, type UsageRecord, type RangeKey } from '~/lib/api/aimetrics'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { BarChart, Donut, CHART_PALETTE, CHART_OTHER, type Slice } from '~/components/ui/Charts'
import {
  groupSpend,
  filterGroups,
  presentDimensions,
  dailySpend,
  type SpendDimension,
  type SpendGroup,
} from './logic'
import { RangeTabs } from './RangeTabs'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const DIM_LABEL: Record<SpendDimension, string> = { model: 'Model', provider: 'Provider' }

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function BillingReports(_props: { params: Record<string, string> }) {
  const [range, setRange] = useState<RangeKey>('30d')
  const [dim, setDim] = useState<SpendDimension>('model')
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<Async<UsageRecord[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setUsage({ phase: 'loading' })
    fetchUsageRecords()
      .then((data) => setUsage({ phase: 'ready', data }))
      .catch((e) => setUsage({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const now = Date.now()
  const records = usage.phase === 'ready' ? usage.data : []
  const windowed = useMemo(() => withinRange(records, range, now), [records, range, now])
  const dims = useMemo(() => presentDimensions(records), [records])
  // If the selected dimension isn't present, fall back to model (always present).
  const activeDim = dims.includes(dim) ? dim : 'model'
  const groups = useMemo(() => groupSpend(windowed, activeDim), [windowed, activeDim])
  const filtered = useMemo(() => filterGroups(groups, query), [groups, query])
  const trend = useMemo(() => dailySpend(windowed, range, now), [windowed, range, now])
  const totalCents = groups.reduce((a, g) => a + g.cents, 0)

  // Spend-share donut — top 7 groups + an "Other" roll-up, categorical palette.
  const slices: Slice[] = useMemo(() => {
    const top = groups.slice(0, 7).map((g, i): Slice => ({ label: g.label, value: g.cents, color: CHART_PALETTE[i % CHART_PALETTE.length] }))
    const rest = groups.slice(7)
    if (rest.length) top.push({ label: `Other (${rest.length})`, value: rest.reduce((a, g) => a + g.cents, 0), color: CHART_OTHER })
    return top
  }, [groups])

  const columns: Column<SpendGroup>[] = [
    { key: 'label', header: DIM_LABEL[activeDim], render: (g) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{g.label}</Text> },
    ...(activeDim === 'model'
      ? [{ key: 'provider', header: 'Provider', width: 140, render: (g: SpendGroup) => <Text fontSize="$3" color="$color11">{g.provider || '—'}</Text> }]
      : []),
    { key: 'requests', header: 'Requests', width: 120, render: (g) => <Text fontSize="$3" color="$color11">{g.requests.toLocaleString()}</Text> },
    { key: 'tokens', header: 'Tokens', width: 130, render: (g) => <Text fontSize="$3" color="$color11">{g.tokens ? g.tokens.toLocaleString() : '—'}</Text> },
    {
      key: 'cents',
      header: 'Cost',
      width: 120,
      render: (g) => (
        <YStack>
          <Text fontSize="$3" color="$color12">{usd(g.cents)}</Text>
          {totalCents > 0 ? <Text fontSize="$1" color="$color10">{Math.round((g.cents / totalCents) * 100)}%</Text> : null}
        </YStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Cost reports"
        subtitle="Spend grouped by service, over a selectable range — the same charged ledger the gateway debits."
        actions={
          <XStack gap="$2" items="center">
            <RangeTabs value={range} onChange={setRange} />
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {usage.phase === 'error' ? (
        <BackendStateCard state={usage.error} onRetry={load} hint="endpoint · GET /v1/billing/usage" />
      ) : (
        <>
          {/* ── Trend + share ──────────────────────────────────────────────── */}
          <XStack flexWrap="wrap" gap="$3">
            <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={2} minW={340}>
              <Text fontSize="$4" fontWeight="800" color="$color12">Daily spend</Text>
              {usage.phase === 'ready' ? <BarChart data={trend} formatValue={(v) => `$${v.toFixed(2)}`} /> : <Text fontSize="$3" color="$color11">Loading…</Text>}
            </Card>
            <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={260} items="center">
              <Text fontSize="$4" fontWeight="800" color="$color12" self="flex-start">Spend share</Text>
              <Donut
                slices={slices}
                center={
                  <YStack items="center">
                    <Text fontSize="$6" fontWeight="900">{usd(totalCents)}</Text>
                    <Text fontSize="$1" color="$color10">total</Text>
                  </YStack>
                }
              />
            </Card>
          </XStack>

          {/* ── Breakdown controls ─────────────────────────────────────────── */}
          <XStack items="center" gap="$2" flexWrap="wrap">
            {dims.length > 1 ? (
              <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
                {dims.map((d) => (
                  <Button key={d} size="$2" chromeless rounded="$0" bg={activeDim === d ? '$color5' : 'transparent'} onPress={() => setDim(d)}>
                    {DIM_LABEL[d]}
                  </Button>
                ))}
              </XStack>
            ) : null}
            <XStack items="center" gap="$2" px="$2.5" height={34} rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" minW={220}>
              <Search size={14} opacity={0.6} />
              <Input flex={1} unstyled value={query} onChangeText={setQuery} placeholder={`Filter ${DIM_LABEL[activeDim].toLowerCase()}s…`} fontSize="$3" color="$color12" autoCapitalize="none" />
              {query ? <Button size="$1" chromeless icon={<X size={13} />} onPress={() => setQuery('')} aria-label="Clear filter" /> : null}
            </XStack>
          </XStack>

          <DataTable
            columns={columns}
            rows={usage.phase === 'ready' ? filtered : []}
            loading={usage.phase === 'loading'}
            rowKey={(g) => g.label}
            empty={query ? `No ${DIM_LABEL[activeDim].toLowerCase()}s match “${query.trim()}”.` : 'No metered spend in this range yet.'}
          />
        </>
      )}
    </>
  )
}
