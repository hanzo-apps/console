'use client'

/**
 * Cost reports — the GCP "Cost table / Reports" surface: spend grouped by a real
 * ledger dimension (model always; provider, product, and agent when the ledger
 * carries them — so Dave sees "which agent/product cost me $X", NO invented
 * project/SKU column), a filterable cost table, a daily-spend bar chart, and a
 * spend-share donut, all over a selectable range.
 *
 * REAL data only: the commerce usage ledger (`GET /v1/billing/usage` via the
 * per-tenant `/billing` proxy), windowed + grouped by the pure `withinRange` /
 * `groupSpend` / `dailySpend`. A load failure degrades to an honest notice; an
 * absent dimension is simply not offered (`presentDimensions`) — the product/agent
 * toggles appear the moment cloud tags spend with `metadata.{product,agent}` and
 * nothing is fabricated until then.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '~/lib/router'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Search, X, Download } from '@hanzogui/lucide-icons-2'

import { fetchUsageRecords, withinRange, type UsageRecord, type RangeKey } from '~/lib/api/aimetrics'
import { exportCSV } from '~/lib/csv'
import { findEntry } from '~/lib/products/registry'
import { BarChart, Donut, type Slice } from '~/components/ui/Charts'
import { RAMP, OTHER } from '~/lib/theme/ramp'
import {
  groupSpend,
  filterGroups,
  presentDimensions,
  dailySpend,
  capRows,
  COST_ROW_CAP,
  type SpendDimension,
  type SpendGroup,
} from './logic'
import { RangeTabs } from './RangeTabs'
import { BackendStateCard, DataTable, PageHeader, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'
import { usd } from '~/lib/money'

const DIM_LABEL: Record<SpendDimension, string> = { model: 'Model', provider: 'Provider', product: 'Product', agent: 'Agent' }

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function BillingReports(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const search = useSearchParams() ?? new URLSearchParams()
  // `?product=<tag>` scopes the whole report to ONE product's meters — the deep-link
  // the per-product overview's Billing quick link uses. The tag is the ledger's
  // `metadata.product`; the label is resolved from the catalog for the filter chip.
  const productParam = search.get('product')
  const productLabel = productParam ? findEntry(productParam)?.label ?? productParam : null

  const [range, setRange] = useState<RangeKey>('30d')
  const [dim, setDim] = useState<SpendDimension>('model')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
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
  const allRecords = usage.phase === 'ready' ? usage.data : []
  // Pre-filter to the deep-linked product's own ledger rows (`metadata.product`)
  // BEFORE any windowing/grouping, so every figure below is that product's real
  // spend — an honest empty when the product carries no attributed spend yet.
  const records = useMemo(
    () => (productParam ? allRecords.filter((r) => r.product === productParam) : allRecords),
    [allRecords, productParam],
  )
  const windowed = useMemo(() => withinRange(records, range, now), [records, range, now])
  const dims = useMemo(() => presentDimensions(records), [records])
  // If the selected dimension isn't present, fall back to model (always present).
  const activeDim = dims.includes(dim) ? dim : 'model'
  const groups = useMemo(() => groupSpend(windowed, activeDim), [windowed, activeDim])
  const filtered = useMemo(() => filterGroups(groups, query), [groups, query])
  // Bound the rendered rows (top-by-spend) so a high-cardinality dimension (agent/
  // product tags are set at inference time) can't blow up the DOM (RED L2); the
  // hidden count is shown honestly and "Show all" reveals every real row.
  const capped = useMemo(() => capRows(filtered, showAll), [filtered, showAll])
  const trend = useMemo(() => dailySpend(windowed, range, now), [windowed, range, now])
  const totalCents = groups.reduce((a, g) => a + g.cents, 0)

  // CSV export of the FULL filtered breakdown (every line item, not just the capped
  // top rows) — timestamp-window + dimension + qty + cost, for a finance review.
  const onExport = useCallback(() => {
    if (!filtered.length) return
    exportCSV(
      `billing-usage-${activeDim}-${range}`,
      [DIM_LABEL[activeDim], 'Provider', 'Requests', 'Tokens', 'Cost (USD)', 'Share'],
      filtered.map((g) => [g.label, g.provider ?? '', g.requests, g.tokens, (g.cents / 100).toFixed(2), totalCents > 0 ? `${Math.round((g.cents / totalCents) * 100)}%` : '0%']),
    )
  }, [filtered, activeDim, range, totalCents])

  // Spend-share donut — top 7 groups + an "Other" roll-up, categorical palette.
  const slices: Slice[] = useMemo(() => {
    const top = groups.slice(0, 7).map((g, i): Slice => ({ label: g.label, value: g.cents, color: RAMP[i % RAMP.length] }))
    const rest = groups.slice(7)
    if (rest.length) top.push({ label: `Other (${rest.length})`, value: rest.reduce((a, g) => a + g.cents, 0), color: OTHER })
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
        title={productLabel ? `Cost reports · ${productLabel}` : 'Cost reports'}
        subtitle={
          productLabel
            ? `Spend attributed to ${productLabel} over a selectable range — the same charged ledger the gateway debits. Empty until spend is tagged to this product.`
            : 'Spend by model, provider, product, or agent over a selectable range — the same charged ledger the gateway debits. Product and agent breakdowns appear once spend is tagged with them.'
        }
        actions={
          <XStack gap="$2" items="center">
            <RangeTabs value={range} onChange={setRange} />
            <Button size="$2" icon={<Download size={15} />} onPress={onExport} disabled={usage.phase !== 'ready' || !filtered.length} aria-label="Export usage CSV">
              Export
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {productLabel ? (
        <XStack items="center" gap="$2" flexWrap="wrap">
          <XStack items="center" gap="$1.5" px="$2.5" py="$1" rounded="$10" bg="$color3" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$2" color="$color11" fontWeight="600">
              Filtered to {productLabel}
            </Text>
            <Button
              size="$1"
              chromeless
              icon={<X size={13} />}
              onPress={() => router.push('/billing/reports')}
              aria-label="Clear product filter"
            />
          </XStack>
        </XStack>
      ) : null}

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
            rows={usage.phase === 'ready' ? capped.rows : []}
            loading={usage.phase === 'loading'}
            rowKey={(g) => g.label}
            empty={query ? `No ${DIM_LABEL[activeDim].toLowerCase()}s match “${query.trim()}”.` : 'No metered spend in this range yet.'}
          />

          {capped.hidden > 0 ? (
            <XStack items="center" justify="center" gap="$2" py="$1" flexWrap="wrap">
              <Text fontSize="$2" color="$color10">
                Showing the top {COST_ROW_CAP} by spend · {capped.hidden.toLocaleString()} more
              </Text>
              <Button size="$2" chromeless onPress={() => setShowAll(true)}>
                Show all
              </Button>
            </XStack>
          ) : showAll && filtered.length > COST_ROW_CAP ? (
            <XStack justify="center" py="$1">
              <Button size="$2" chromeless onPress={() => setShowAll(false)}>
                Show top {COST_ROW_CAP}
              </Button>
            </XStack>
          ) : null}
        </>
      )}
    </>
  )
}
