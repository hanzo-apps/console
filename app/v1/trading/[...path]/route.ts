/**
 * Per-user proxy to the LIVE trading-bot state — the Trading module's ONE
 * live-data transport (the DEPLOYED FLEET is read separately via the `/v1`
 * PaaS proxy). The browser calls console2's OWN origin (`/v1/trading/*`) with just
 * the session cookie; this handler resolves the caller, resolves the BRAND from the
 * request host, and reads the allowlisted upstreams server-side, per network that
 * brand may see. No cluster host or RPC method ever reaches the browser, and the
 * browser can never choose either.
 *
 * Security (mirrors app/nodes/[...path]/route.ts):
 *  - Session-gated: an unauthenticated caller gets 401.
 *  - Org/brand-aware: the network set is scoped by `nodeNetworksForBrand(brand)`,
 *    brand resolved from the host — cloud.lux.cloud sees only Lux networks.
 *  - Least privilege: the ONLY paths are `metrics` and `orderbook`; the ONLY
 *    upstreams are the maker's :2112 /metrics scrape and the DEX read endpoint —
 *    this is not a general RPC/HTTP tunnel.
 *
 * Two upstreams, one concern each:
 *  1. METRICS — GETs the in-cluster maker's Prometheus `:2112/metrics` for a
 *     network and parses it to `MakerStatus`. The maker Service host per network is
 *     env-configurable; unset/unreachable → an honest `not-reporting` status.
 *  2. ORDERBOOK — reads the DEX CLOB `dex_get_orders?market=<poolHex>` for a market
 *     on a network. The DEX read host is env-configurable; the private D-Chain is
 *     not publicly exposed, so an unreachable venue → an honest `not-reporting` book
 *     (never fabricated bids/asks).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { brandFromHost } from '~/config'
import { resolveUser } from '~/lib/server/identity'
import { nodeNetworksForBrand, type NodeNetworkId } from '~/lib/products/brand-scope'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'
import {
  parseMakerMetrics,
  normalizeBook,
  type MakerStatus,
  type OrderBook,
  type RawBookOrder,
} from '~/lib/api/trading'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')

/**
 * The maker's Prometheus metrics host per network — the ONLY metrics endpoint this
 * proxy will scrape. These point at the in-cluster maker Service (`maker-coherence`,
 * port 2112) per luxd network namespace. Each is overridable per-deploy; an
 * unset/unreachable host yields an honest `not-reporting` status — never fake rows.
 * (Cross-cluster reach depends on network policy; when unreachable the console shows
 * the honest not-reporting state, exactly like the Nodes surface.)
 */
const MAKER_METRICS_HOSTS: Partial<Record<NodeNetworkId, string>> = {
  'lux-mainnet': trim(process.env.MAKER_METRICS_MAINNET ?? 'http://maker-coherence.lux-mainnet.svc:2112'),
  'lux-testnet': trim(process.env.MAKER_METRICS_TESTNET ?? 'http://maker-coherence.lux-testnet.svc:2112'),
  'lux-devnet': trim(process.env.MAKER_METRICS_DEVNET ?? 'http://maker-coherence.lux-devnet.svc:2112'),
}

/**
 * The DEX read host per network — the ONLY DEX endpoint this proxy will query for
 * the order book (`<host>/dex/dex_get_orders?market=<poolHex>`). The native D-Chain
 * CLOB is not publicly exposed, so these default to the in-cluster luxd router;
 * unreachable → an honest `not-reporting` book.
 */
const DEX_READ_HOSTS: Partial<Record<NodeNetworkId, string>> = {
  'lux-mainnet': trim(process.env.DEX_READ_MAINNET ?? 'http://luxd-0.luxd-headless.lux-mainnet.svc:9630/v1/bc/D'),
  'lux-testnet': trim(process.env.DEX_READ_TESTNET ?? 'http://luxd-0.luxd-headless.lux-testnet.svc:9640/v1/bc/D'),
  'lux-devnet': trim(process.env.DEX_READ_DEVNET ?? 'http://luxd-0.luxd-headless.lux-devnet.svc:9650/v1/bc/D'),
}

/** Per-upstream probe timeout (ms). */
const TIMEOUT_MS = Number(process.env.TRADING_TIMEOUT_MS ?? 8000)

/** Scrape ONE network's maker metrics → MakerStatus. Honest not-reporting on failure. */
async function makerStatus(net: NodeNetworkId): Promise<MakerStatus> {
  const host = MAKER_METRICS_HOSTS[net]
  const base: MakerStatus = { status: 'not-reporting', symbols: [] }
  if (!host) {
    base.error = 'no metrics host configured for this network'
    return base
  }
  try {
    const res = await fetchWithTimeout(
      `${host}/metrics`,
      { headers: { accept: 'text/plain' }, cache: 'no-store' },
      { timeoutMs: TIMEOUT_MS },
    )
    if (!res.ok) {
      base.error = `metrics ${res.status}`
      return base
    }
    const text = await res.text()
    const parsed = parseMakerMetrics(text)
    return { status: 'reporting', ...parsed }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    return base
  }
}

/** A single allowlisted DEX read call. `method` is fixed here (dex_get_orders). */
async function dexGetOrders(host: string, poolHex: string): Promise<RawBookOrder[]> {
  const url = `${host}/dex/dex_get_orders?market=${encodeURIComponent(poolHex)}`
  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' }, cache: 'no-store' }, { timeoutMs: TIMEOUT_MS })
  if (!res.ok) throw new Error(`dex_get_orders ${res.status}`)
  const json = (await res.json()) as { orders?: RawBookOrder[] }
  return Array.isArray(json?.orders) ? json.orders : []
}

/**
 * Read ONE market's order book. A `poolId` (32-byte hex) addresses the book
 * directly; a `symbol`/`base`/`quote` are echoed for display but the book is only
 * readable by poolId (the console does not compute keccak client- or server-side to
 * avoid an eth-crypto dep — the caller supplies the poolId, or the book is honestly
 * not-reporting). Honest not-reporting when the DEX is unreachable.
 */
async function orderbook(net: NodeNetworkId, params: URLSearchParams): Promise<OrderBook> {
  const symbol = params.get('symbol') ?? undefined
  const poolId = params.get('poolId') ?? undefined
  const base: OrderBook = { network: net, symbol, poolId, status: 'not-reporting', orders: [] }

  const host = DEX_READ_HOSTS[net]
  if (!host) {
    base.error = 'no DEX read host configured for this network'
    return base
  }
  if (!poolId) {
    // No poolId → the book can't be addressed. Honest, never fabricated.
    base.error = 'order book is read by poolId; none supplied for this market'
    return base
  }
  try {
    const raw = await dexGetOrders(host, poolId)
    return { ...base, status: 'reporting', orders: normalizeBook(raw), error: undefined }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    return base
  }
}

/** Resolve the brand's networks, optionally narrowed to `?network=` (still gated). */
function scopedNetworks(req: NextRequest): NodeNetworkId[] {
  const brand = brandFromHost(req.headers.get('host'))
  let networks = nodeNetworksForBrand(brand)
  const only = req.nextUrl.searchParams.get('network') as NodeNetworkId | null
  if (only) networks = networks.filter((n) => n === only)
  return networks
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  const route = path.join('/')

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view trading bots.' }, { status: 401 })
  }

  if (route === 'metrics') {
    const networks = scopedNetworks(req)
    // A single-network scope is the common case (per-bot status); return the first
    // (the network the caller asked for), or the brand's first if none specified.
    const net = networks[0]
    if (!net) return NextResponse.json({ status: 'not-reporting', symbols: [], error: 'no network in scope' })
    const status = await makerStatus(net)
    return NextResponse.json(status)
  }

  if (route === 'orderbook') {
    const networks = scopedNetworks(req)
    const net = networks[0]
    if (!net) {
      return NextResponse.json({ network: null, status: 'not-reporting', orders: [], error: 'no network in scope' })
    }
    const book = await orderbook(net, req.nextUrl.searchParams)
    return NextResponse.json(book)
  }

  return NextResponse.json({ error: 'not found' }, { status: 404 })
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
