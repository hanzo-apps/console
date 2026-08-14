'use client'

/**
 * Markets — the Lux DEX economy dashboard (the DeFiLlama-style analytics plane). It
 * composes TWO real surfaces, one component:
 *
 *  1. The living-overview KPI board (`livingOverviewModule('lux-economy')`) — active
 *     markets, 24h volume, trades, book depth, per-market donuts, recent-trade feed,
 *     and maker health — driven by the ONE reusable `LivingOverview` over the
 *     `fromLuxIndexer` adapter (the DEX indexer + maker metrics). No bespoke board UI.
 *
 *  2. The markets TABLE (the DeFiLlama row-per-market view) — market · last price ·
 *     best bid/ask spread · 24h volume · 24h trades · open orders · book depth — read
 *     from the SAME `/economy` proxy (the `dex` subgraph). Honest "—" for any field the
 *     CLOB subgraph does not expose (there is no pooled USD TVL on a CLOB), honest
 *     not-reporting when the indexer is unreachable — never fabricated liquidity.
 *
 * This is the management/analytics plane; the sibling Trading module is the
 * deploy/manage plane for the bots that MAKE these markets. Both are on lux.cloud.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, YStack } from '@hanzo/gui'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { livingOverviewModule } from '~/components/products/overview/living/LivingOverviewModule'
import { EconomyApi, fmtNum, fmtPrice, fmtSpread, type EconomySnapshot } from '~/lib/api/economy'
import { findEntry } from '~/lib/products/registry'
import { BackendStateCard, EmptyState, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

/** The living-overview KPI board for the Lux economy (the reusable board). */
const EconomyBoard = livingOverviewModule('lux-economy')

/** Columns for the DeFiLlama-style markets table. */
const MARKET_FIELDS: FieldDefinition[] = [
  { name: 'symbol', label: 'Market', type: 'text', width: 160 },
  { name: 'lastPrice', label: 'Last price', type: 'text', width: 130 },
  { name: 'bestBid', label: 'Best bid', type: 'text', width: 120 },
  { name: 'bestAsk', label: 'Best ask', type: 'text', width: 120 },
  { name: 'spread', label: 'Spread', type: 'text', width: 110 },
  { name: 'volume24h', label: '24h volume', type: 'text', width: 130 },
  { name: 'trades', label: '24h trades', type: 'text', width: 110 },
  { name: 'openOrders', label: 'Open orders', type: 'text', width: 120 },
  { name: 'depth', label: 'Book depth', type: 'text', width: 130 },
]

export function MarketsModule(_props: { params: Record<string, string> }) {
  const [snap, setSnap] = useState<EconomySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setState(null)
    try {
      setSnap(await EconomyApi.overview())
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const marketsIcon = findEntry('markets')?.icon
  const rows = (snap?.markets ?? []).map((m) => ({
    _id: m.id,
    symbol: m.symbol,
    lastPrice: fmtPrice(m.lastPrice),
    bestBid: fmtPrice(m.bestBid),
    bestAsk: fmtPrice(m.bestAsk),
    spread: fmtSpread(m.spreadBps),
    volume24h: fmtNum(m.volume24h),
    trades: fmtNum(m.tradeCount),
    openOrders: fmtNum(m.openOrders),
    depth: fmtNum(m.bookDepth),
  }))

  const reporting = snap?.status === 'reporting'
  const noMarkets = reporting && rows.length === 0

  return (
    <YStack gap="$5">
      {/* The reusable KPI board (the same LivingOverview every product uses). */}
      <EconomyBoard params={{}} />

      {/* The DeFiLlama-style markets table (the row-per-market view). */}
      <YStack gap="$2">
        <PageHeader
          title="Markets"
          subtitle="Per-market book summary from the Lux DEX indexer — last price, best bid/ask spread, 24h volume, trades, and book depth. USD TVL is not shown for a CLOB (a limit-order book has depth, not pooled TVL)."
          actions={<Button size="$3" onPress={load} disabled={loading}>Refresh</Button>}
        />

        {state ? (
          <BackendStateCard state={state} onRetry={load} hint="endpoint · GET /v1/economy/overview" />
        ) : !reporting && !loading ? (
          <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
            <Text fontSize="$3" fontWeight="700">Indexer not reporting</Text>
            <Text fontSize="$2" color="$color10">
              The DEX indexer did not answer{snap?.error ? ` — ${snap.error}` : ''}. The markets table fills in
              once the indexer is reachable.
            </Text>
          </Card>
        ) : noMarkets && marketsIcon ? (
          <EmptyState
            icon={marketsIcon}
            title="No markets indexed yet"
            description="The DEX indexer is reachable and reports no markets on this network yet. Deploy a market maker in Trading to seed the L*/LUX books, or wait for the indexer to catch up."
          />
        ) : (
          <DataTable fields={MARKET_FIELDS} records={rows} loading={loading} empty="No markets on this network." />
        )}
      </YStack>
    </YStack>
  )
}

