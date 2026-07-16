/**
 * Per-user proxy to the Lux DEX indexer's `dex` subgraph — the Lux Economy /
 * Markets board's ONE transport. The browser calls console2's OWN origin
 * (`/v1/economy/overview`) with just the session cookie; this handler resolves the
 * caller, resolves the BRAND from the request host, and POSTs a FIXED, allowlisted
 * GraphQL query to the in-cluster graphd per brand-scoped network, returning the
 * NORMALIZED markets + fills + day-data. No graph host or GraphQL query ever reaches
 * the browser, and the browser can never compose one.
 *
 * Security (mirrors app/nodes/[...path]/route.ts):
 *  - Session-gated: an unauthenticated caller gets 401.
 *  - Org/brand-aware: the network set is scoped by `nodeNetworksForBrand(brand)`,
 *    brand resolved from the host — cloud.lux.cloud sees only Lux networks.
 *  - Least privilege: the ONLY path is `overview`, and the ONLY GraphQL query is
 *    the fixed markets+fills+dayData read below — this is not a general GraphQL
 *    tunnel (no client-supplied query, no mutations, no arbitrary entity).
 *
 * Honest by construction: an unset/unreachable graph host yields a `not-reporting`
 * snapshot with the real error — never fabricated markets. The native DEX is a CLOB,
 * so the query asks only for the fields the `dex` subgraph really exposes.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { brandFromHost } from '~/config'
import { resolveUser } from '~/lib/server/identity'
import { nodeNetworksForBrand, type NodeNetworkId } from '~/lib/products/brand-scope'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'
import {
  normalizeMarkets,
  normalizeTrades,
  normalizeDayData,
  type EconomySnapshot,
  type RawMarket,
  type RawFill,
  type RawMarketDayData,
} from '~/lib/api/economy'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')

/**
 * The `dex` subgraph GraphQL endpoint per network — the ONLY endpoint this proxy
 * will query. graphd serves the DEX subgraph at `<prefix>/graphql` (default prefix
 * `/v1/graph/cchain/dex`); each is overridable per-deploy. An unset/unreachable host
 * yields an honest `not-reporting` snapshot — never fake markets. (Cross-cluster
 * reach depends on network policy; when unreachable the board shows honest empty.)
 */
const GRAPH_HOSTS: Partial<Record<NodeNetworkId, string>> = {
  'lux-mainnet': trim(process.env.DEX_GRAPHQL_MAINNET ?? 'http://graph.lux-mainnet.svc:8080/v1/graph/cchain/dex/graphql'),
  'lux-testnet': trim(process.env.DEX_GRAPHQL_TESTNET ?? 'http://graph.lux-testnet.svc:8080/v1/graph/cchain/dex/graphql'),
  'lux-devnet': trim(process.env.DEX_GRAPHQL_DEVNET ?? 'http://graph.lux-devnet.svc:8080/v1/graph/cchain/dex/graphql'),
}

/** Per-query timeout (ms). */
const TIMEOUT_MS = Number(process.env.ECONOMY_TIMEOUT_MS ?? 8000)

/**
 * The ONE fixed GraphQL query — markets (book summary + accrued 24h aggregates),
 * recent fills (the trade feed), and day-data (the historical series, empty until a
 * MarketDayData producer emits). Only fields the `dex` subgraph really exposes.
 */
const QUERY = `query LuxEconomy {
  markets(first: 100) {
    id
    symbol
    baseToken
    quoteToken
    assetsBound
    openOrders
    remaining
    bestBid
    bestAsk
    volume24h
    tradeCount
    lastPrice
    feeTier
  }
  fills(first: 40) {
    id
    symbol
    price
    size
    side
    timestamp
  }
  marketDayDatas(first: 90) {
    id
    date
    symbol
    volumeUSD
    feesUSD
    tvlUSD
  }
}`

interface GraphResp {
  data?: { markets?: RawMarket[]; fills?: RawFill[]; marketDayDatas?: RawMarketDayData[] }
  errors?: { message?: string }[]
}

/** Query ONE network's `dex` subgraph → normalized snapshot. Honest not-reporting on failure. */
async function probe(net: NodeNetworkId): Promise<EconomySnapshot> {
  const base: EconomySnapshot = { network: net, status: 'not-reporting', markets: [], trades: [], dayData: [] }
  const host = GRAPH_HOSTS[net]
  if (!host) {
    base.error = 'no DEX GraphQL host configured for this network'
    return base
  }
  try {
    const res = await fetchWithTimeout(
      host,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: QUERY }),
        cache: 'no-store',
      },
      { timeoutMs: TIMEOUT_MS },
    )
    if (!res.ok) {
      base.error = `graphql ${res.status}`
      return base
    }
    const json = (await res.json()) as GraphResp
    if (json?.errors?.length) {
      base.error = json.errors[0]?.message ?? 'graphql error'
      return base
    }
    const d = json?.data ?? {}
    return {
      network: net,
      status: 'reporting',
      markets: normalizeMarkets(d.markets),
      trades: normalizeTrades(d.fills),
      dayData: normalizeDayData(d.marketDayDatas),
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    return base
  }
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  // This handler lives at `app/v1/economy/[...path]`, so the catch-all captures the
  // sub-path after `/v1/economy/`.
  if (path.join('/') !== 'overview') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view the market economy.' }, { status: 401 })
  }

  const brand = brandFromHost(req.headers.get('host'))
  let networks = nodeNetworksForBrand(brand)
  const only = req.nextUrl.searchParams.get('network') as NodeNetworkId | null
  if (only) networks = networks.filter((n) => n === only)

  // Query the brand's networks and return the FIRST that reports markets (the live
  // economy), else the first reporting network, else the first (honest not-reporting).
  const snaps = await Promise.all(networks.map(probe))
  const withMarkets = snaps.find((s) => s.status === 'reporting' && s.markets.length > 0)
  const reporting = snaps.find((s) => s.status === 'reporting')
  const chosen = withMarkets ?? reporting ?? snaps[0]
  if (!chosen) {
    return NextResponse.json({ network: null, status: 'not-reporting', markets: [], trades: [], dayData: [], error: 'no network in scope' })
  }
  return NextResponse.json(chosen)
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
