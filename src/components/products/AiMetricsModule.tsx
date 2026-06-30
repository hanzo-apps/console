'use client'

/**
 * AI Metrics — the customer's "where's my AI usage / metrics" answer.
 *
 * One real source: the per-org commerce usage ledger (`GET /v1/billing/usage`)
 * through the console's OWN `/billing/*` server proxy (service token injected
 * server-side, scope pinned to the caller's org — the browser never holds a
 * credential and cannot widen scope), plus the org's cloud-credit balance from
 * the same proxy. The model catalog (`/v1/pricing/models` via the `/ai` proxy)
 * is joined in best-effort for display names + per-Mtok pricing; if it is
 * unreachable, the raw model id and a "—" price are shown (never fabricated).
 *
 * Four sections, all from the same records (aggregated by the pure functions in
 * `lib/api/aimetrics`): stat tiles (requests / tokens / spend / balance) with a
 * 24h·7d·30d range selector, a per-day usage chart (requests | tokens | cost), a
 * per-model breakdown table, and the latest activity. Every section has honest
 * loading / empty / error states — an org with no usage rolls up to zeros and
 * empty tables; a proxy failure shows the shared `BackendStateCard`. Nothing is
 * fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, ArrowUpDown, Coins, CreditCard, RefreshCw, Wallet } from '@hanzogui/lucide-icons-2'

import {
  RANGE_DAYS,
  dailySeries,
  fetchBalance,
  fetchUsageRecords,
  perModel,
  recent,
  totalsOf,
  withinRange,
  type ModelUsage,
  type RangeKey,
  type UsageRecord,
} from '~/lib/api/aimetrics'
import type { CloudBalance } from '~/lib/api/wallet'
import { fetchCatalog, displayProvider, fmtPrice, type CatalogEntry } from '~/lib/api/aicatalog'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { StatTile } from './aimetrics/StatTile'
import { UsageChart, type ChartMetric } from './aimetrics/UsageChart'
import { ago, count, tokens, usd } from './aimetrics/format'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
]

const CHART_METRICS: { key: ChartMetric; label: string }[] = [
  { key: 'requests', label: 'Requests' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'cost', label: 'Cost' },
]

const RECENT_LIMIT = 20

/** A per-model row joined with its catalog display name + per-Mtok pricing. */
type ModelRow = ModelUsage & { displayName: string; provider: string; inputPrice?: number; outputPrice?: number }

/** Join a model usage rollup to the catalog (best-effort display name + price). */
function joinCatalog(rows: ModelUsage[], catalog: Map<string, CatalogEntry>): ModelRow[] {
  return rows.map((r) => {
    const hit = r.model ? catalog.get(r.model.toLowerCase()) : undefined
    return {
      ...r,
      displayName: hit?.name || r.model || 'Unknown model',
      provider: r.provider || (hit?.provider ? displayProvider(hit.provider) : ''),
      inputPrice: hit?.pricing?.input,
      outputPrice: hit?.pricing?.output,
    }
  })
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; records: UsageRecord[] }

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <XStack gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$3" p="$1">
      {options.map((o) => (
        <Button
          key={o.key}
          size="$2"
          chromeless={value !== o.key}
          bg={value === o.key ? '$color5' : 'transparent'}
          onPress={() => onChange(o.key)}
        >
          {o.label}
        </Button>
      ))}
    </XStack>
  )
}

/** A titled section so each block reads its own state. */
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <YStack gap="$2">
      <XStack items="center" justify="space-between" gap="$3">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          {title}
        </Text>
        {action}
      </XStack>
      {children}
    </YStack>
  )
}

export function AiMetricsModule(_props: { params: Record<string, string> }) {
  const [range, setRange] = useState<RangeKey>('7d')
  const [chartMetric, setChartMetric] = useState<ChartMetric>('requests')
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  // Balance + catalog load independently so neither blocks the usage view.
  const [balance, setBalance] = useState<CloudBalance | null>(null)
  const [catalog, setCatalog] = useState<Map<string, CatalogEntry>>(new Map())
  // A stable "now" per load so the range math + the chart axis agree.
  const [now, setNow] = useState<number>(() => Date.now())

  const load = useCallback(() => {
    const at = Date.now()
    setNow(at)
    setState({ phase: 'loading' })
    setBalance(null)
    fetchUsageRecords()
      .then((records) => setState({ phase: 'ready', records }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
    // Balance + catalog are best-effort enrichments — a failure degrades that
    // one widget (tile shows "—", table shows the raw id), never the page.
    fetchBalance()
      .then(setBalance)
      .catch(() => setBalance(null))
    fetchCatalog()
      .then((entries) => setCatalog(new Map(entries.map((e) => [e.name.toLowerCase(), e]))))
      .catch(() => setCatalog(new Map()))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const allRecords = state.phase === 'ready' ? state.records : []
  const windowed = useMemo(() => withinRange(allRecords, range, now), [allRecords, range, now])
  const totals = useMemo(() => totalsOf(windowed), [windowed])
  const series = useMemo(() => dailySeries(windowed, range, now), [windowed, range, now])
  const modelRows = useMemo(() => joinCatalog(perModel(windowed), catalog), [windowed, catalog])
  const recentRows = useMemo(() => recent(windowed, RECENT_LIMIT), [windowed, now])

  const loading = state.phase === 'loading'
  const rangeLabel = range === '24h' ? 'last 24 hours' : `last ${RANGE_DAYS[range]} days`

  const modelColumns: Column<ModelRow>[] = [
    {
      key: 'model',
      header: 'Model',
      render: (m) => (
        <YStack gap={1}>
          <Text fontSize="$3" color="$color12" numberOfLines={1}>
            {m.displayName}
          </Text>
          {m.provider ? (
            <Text fontSize="$1" color="$color10">
              {m.provider}
            </Text>
          ) : null}
        </YStack>
      ),
    },
    { key: 'requests', header: 'Requests', width: 110, render: (m) => <Text fontSize="$3" color="$color11">{count(m.requests)}</Text> },
    {
      key: 'tokens',
      header: 'Tokens (in / out)',
      width: 160,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {tokens(m.totalTokens)}
          <Text fontSize="$1" color="$color10">
            {'  '}
            {tokens(m.promptTokens)} / {tokens(m.completionTokens)}
          </Text>
        </Text>
      ),
    },
    {
      key: 'price',
      header: '$/Mtok',
      width: 130,
      render: (m) => (
        <Text fontSize="$2" color="$color10" numberOfLines={1}>
          {fmtPrice(m.inputPrice)} / {fmtPrice(m.outputPrice)}
        </Text>
      ),
    },
    { key: 'cents', header: 'Cost', width: 100, render: (m) => <Text fontSize="$3" fontWeight="600" color="$color12">{usd(m.cents)}</Text> },
  ]

  const recentColumns: Column<UsageRecord>[] = [
    { key: 'at', header: 'When', width: 120, render: (r) => <Text fontSize="$3" color="$color11">{ago(r.at, now)}</Text> },
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <Text fontSize="$3" color="$color12" numberOfLines={1}>
          {r.model || (r.notes ? r.notes : 'API usage')}
        </Text>
      ),
    },
    { key: 'provider', header: 'Provider', width: 120, render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.provider || '—'}</Text> },
    { key: 'tokens', header: 'Tokens', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{r.totalTokens > 0 ? tokens(r.totalTokens) : '—'}</Text> },
    { key: 'cents', header: 'Cost', width: 90, render: (r) => <Text fontSize="$3" color="$color12">{usd(r.cents)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title="AI Metrics"
        subtitle="Requests, tokens, and spend for your organization — from the same usage the gateway bills."
        actions={
          <XStack gap="$2" items="center">
            <Toggle options={RANGES} value={range} onChange={setRange} />
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard
          state={state.error}
          onRetry={load}
          hint="endpoint · GET /v1/billing/usage (per-org, via the /billing proxy)"
        />
      ) : (
        <>
          {/* ── Stat tiles (real, windowed) ───────────────────────────────── */}
          <XStack flexWrap="wrap" gap="$3">
            <StatTile
              label={`Requests · ${rangeLabel}`}
              value={count(totals.requests)}
              icon={<Activity size={15} />}
              loading={loading}
            />
            <StatTile
              label="Tokens"
              value={tokens(totals.totalTokens)}
              sub={`${tokens(totals.promptTokens)} in · ${tokens(totals.completionTokens)} out`}
              icon={<ArrowUpDown size={15} />}
              loading={loading}
            />
            <StatTile
              label="Spend"
              value={usd(totals.cents)}
              icon={<Coins size={15} />}
              loading={loading}
            />
            <StatTile
              label="Credit balance"
              value={balance ? usd(balance.available) : '—'}
              sub={balance ? `${usd(balance.balance)} total · ${usd(balance.holds)} on hold` : 'available now'}
              icon={<Wallet size={15} />}
              loading={loading && balance === null}
            />
          </XStack>

          {/* ── Usage over time ───────────────────────────────────────────── */}
          <Section
            title="Usage over time"
            action={<Toggle options={CHART_METRICS} value={chartMetric} onChange={setChartMetric} />}
          >
            {loading ? (
              <Card height={200} items="center" justify="center" borderWidth={1} borderColor="$borderColor">
                <Text color="$color10" fontSize="$2">Loading usage…</Text>
              </Card>
            ) : (
              <UsageChart series={series} metric={chartMetric} />
            )}
          </Section>

          {/* ── Per-model breakdown ───────────────────────────────────────── */}
          <Section title="By model">
            <DataTable
              columns={modelColumns}
              rows={modelRows}
              loading={loading}
              rowKey={(m) => m.model || 'unknown'}
              empty={`No model usage in the ${rangeLabel}. Calls appear here as your org uses the gateway.`}
            />
          </Section>

          {/* ── Recent activity ───────────────────────────────────────────── */}
          <Section
            title="Recent activity"
            action={
              <Button
                size="$2"
                chromeless
                icon={<CreditCard size={14} />}
                onPress={() => {
                  if (typeof window !== 'undefined') window.open(`${config.billingUrl}/topup`, '_blank', 'noopener')
                }}
              >
                Add credits
              </Button>
            }
          >
            <DataTable
              columns={recentColumns}
              rows={recentRows}
              loading={loading}
              rowKey={(r) => r.id}
              empty={`No activity in the ${rangeLabel} yet.`}
            />
          </Section>
        </>
      )}
    </>
  )
}
