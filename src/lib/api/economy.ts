/**
 * EconomyApi — the live-data client for the Lux Economy / Markets dashboard (the
 * DeFiLlama-style board). Reads the Lux DEX indexer's `dex` subgraph GraphQL through
 * console2's OWN session-gated, brand-scoped `/economy` proxy (mirrors `/nodes`): the
 * browser sends only its session cookie, the server POSTs an allowlisted GraphQL query
 * to the in-cluster graphd per brand-scoped network and returns the entities.
 *
 * Everything below `EconomyApi` is PURE (no I/O): the GraphQL-entity → view-model maps
 * are unit-tested against the real wire shapes (economy.test.ts). HONEST by construction
 * — the native DEX is a CLOB, so it exposes book depth + per-market volume24h/lastPrice,
 * NOT a pooled `tvlUSD` (that's an AMM concept). We render EXACTLY what the subgraph
 * reports (24h volume, trades, book depth, best bid/ask, last price) and show an honest
 * dash for anything it does not expose — never a fabricated TVL/volume.
 */
import { ApiError } from './client'
import type { NodeNetworkId } from '~/lib/products/brand-scope'

// ── Raw GraphQL entity shapes (from luxfi/graph resolvers/dex + indexer/clob.go) ──

/** Raw Market as the `dex` subgraph returns it (CLOB book summary + accrued aggregates). */
export interface RawMarket {
  id?: string
  symbol?: string
  baseToken?: string
  quoteToken?: string
  assetsBound?: boolean
  openOrders?: number
  /** Total resting size on the book (the CLOB "liquidity" / depth proxy). String or number. */
  remaining?: string | number
  bestBid?: string | number
  bestAsk?: string | number
  /** Accrued 24h volume (string, raw units). Present when the chain accrues it; else absent. */
  volume24h?: string | number
  tradeCount?: string | number
  lastPrice?: string | number
  feeTier?: string | number
  [k: string]: unknown
}

/** Raw Fill (a settled trade) as the `dex` subgraph returns it. */
export interface RawFill {
  id?: string
  symbol?: string
  price?: string | number
  /** Size/quantity (schema uses `size` on the CLOB fill; `quantity`/`volume` on EVM). */
  size?: string | number
  quantity?: string | number
  volume?: string | number
  side?: string
  maker?: string
  taker?: string
  /** ISO-8601 or unix (seconds/ms) — normalized defensively. */
  timestamp?: string | number
  [k: string]: unknown
}

/** Raw MarketDayData (a day snapshot) — the historical volume series source. */
export interface RawMarketDayData {
  id?: string
  /** Unix day (seconds) or an ISO date. */
  date?: string | number
  symbol?: string
  volumeUSD?: string | number
  volume?: string | number
  feesUSD?: string | number
  tvlUSD?: string | number
  open?: string | number
  close?: string | number
  [k: string]: unknown
}

// ── View-models ──────────────────────────────────────────────────────────────

/** One market row for the DeFiLlama-style markets table (all real or honest undefined). */
export interface Market {
  /** poolId (hex) — the stable market id. */
  id: string
  /** Human pair (e.g. "LETH/LUX") or the raw poolId hex when unbound. */
  symbol: string
  baseToken?: string
  quoteToken?: string
  /** Last traded price, when the chain reports it. */
  lastPrice?: number
  bestBid?: number
  bestAsk?: number
  /** Book spread in bps between best bid/ask, when both are present. */
  spreadBps?: number
  /** Accrued 24h volume, when the chain accrues it (else honest undefined). */
  volume24h?: number
  /** 24h trade count, when known. */
  tradeCount?: number
  /** Open resting orders on the book. */
  openOrders?: number
  /** Total resting size on the book — the CLOB depth / "liquidity" proxy. */
  bookDepth?: number
}

/** A settled trade for the activity feed. */
export interface Trade {
  id: string
  symbol: string
  price?: number
  size?: number
  side?: string
  /** Epoch ms, when parseable. */
  timeMs?: number
}

/** A day snapshot point (for the historical volume/tvl series). */
export interface DayPoint {
  /** Epoch seconds of the day bucket. */
  date: number
  volumeUSD?: number
  feesUSD?: number
  tvlUSD?: number
}

/** The whole economy snapshot for a network, as the `/economy` proxy returns it. */
export interface EconomySnapshot {
  network: NodeNetworkId
  /** `reporting` = the graph answered; `not-reporting` = unreachable/errored. */
  status: 'reporting' | 'not-reporting'
  /** Present when `not-reporting` — the real upstream error (never fabricated data). */
  error?: string
  markets: Market[]
  trades: Trade[]
  dayData: DayPoint[]
}

// ── Pure normalizers ─────────────────────────────────────────────────────────

/** Parse a string|number to a finite number, or undefined (honest — never NaN/0-fill). */
export function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Best-bid/ask → spread in bps ((ask-bid)/mid·1e4), or undefined when either is missing. */
export function spreadBps(bid?: number, ask?: number): number | undefined {
  if (bid == null || ask == null || bid <= 0 || ask <= 0 || ask < bid) return undefined
  const mid = (bid + ask) / 2
  if (mid <= 0) return undefined
  return ((ask - bid) / mid) * 10_000
}

/** Normalize a raw Market → the table view-model. PURE. */
export function normalizeMarket(m: RawMarket): Market | null {
  const id = typeof m.id === 'string' ? m.id : undefined
  if (!id) return null
  const bestBid = num(m.bestBid)
  const bestAsk = num(m.bestAsk)
  return {
    id,
    symbol: typeof m.symbol === 'string' && m.symbol ? m.symbol : id,
    baseToken: typeof m.baseToken === 'string' ? m.baseToken : undefined,
    quoteToken: typeof m.quoteToken === 'string' ? m.quoteToken : undefined,
    lastPrice: num(m.lastPrice),
    bestBid,
    bestAsk,
    spreadBps: spreadBps(bestBid, bestAsk),
    volume24h: num(m.volume24h),
    tradeCount: num(m.tradeCount),
    openOrders: num(m.openOrders),
    bookDepth: num(m.remaining),
  }
}

/** Normalize raw Markets → sorted (by 24h volume desc, then symbol) view-models. PURE. */
export function normalizeMarkets(raw: RawMarket[] | undefined): Market[] {
  const out = (raw ?? []).map(normalizeMarket).filter((m): m is Market => m !== null)
  out.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0) || a.symbol.localeCompare(b.symbol))
  return out
}

/** Parse a timestamp (ISO | unix s | unix ms) → epoch ms, or undefined. PURE. */
export function parseTimeMs(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return undefined
    // Heuristic: <1e12 is seconds, else ms.
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v)
  }
  const s = String(v)
  const asNum = Number(s)
  if (Number.isFinite(asNum)) return asNum < 1e12 ? Math.round(asNum * 1000) : Math.round(asNum)
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : undefined
}

/** Normalize a raw Fill → a trade row. PURE. */
export function normalizeTrade(f: RawFill): Trade | null {
  const id = typeof f.id === 'string' ? f.id : undefined
  if (!id) return null
  return {
    id,
    symbol: typeof f.symbol === 'string' && f.symbol ? f.symbol : '—',
    price: num(f.price),
    size: num(f.size) ?? num(f.quantity) ?? num(f.volume),
    side: typeof f.side === 'string' ? f.side : undefined,
    timeMs: parseTimeMs(f.timestamp),
  }
}

/** Normalize raw Fills → trades, newest first. PURE. */
export function normalizeTrades(raw: RawFill[] | undefined): Trade[] {
  const out = (raw ?? []).map(normalizeTrade).filter((t): t is Trade => t !== null)
  out.sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0))
  return out
}

/** Parse a MarketDayData.date (unix seconds | ISO) → epoch seconds. PURE. */
export function parseDaySeconds(v: unknown): number | undefined {
  const ms = parseTimeMs(v)
  return ms == null ? undefined : Math.floor(ms / 1000)
}

/** Normalize raw MarketDayData → day points, oldest first. PURE. */
export function normalizeDayData(raw: RawMarketDayData[] | undefined): DayPoint[] {
  const out: DayPoint[] = []
  for (const d of raw ?? []) {
    const date = parseDaySeconds(d.date)
    if (date == null) continue
    out.push({
      date,
      volumeUSD: num(d.volumeUSD) ?? num(d.volume),
      feesUSD: num(d.feesUSD),
      tvlUSD: num(d.tvlUSD),
    })
  }
  out.sort((a, b) => a.date - b.date)
  return out
}

// ── Formatting helpers (PURE) ────────────────────────────────────────────────

/** Compact number ("1.2M" / "3,400" / "—"), honest dash when unknown. */
export function fmtNum(v?: number): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** Price with sensible precision, honest dash when unknown. */
export const fmtPrice = (v?: number): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 6 })

/** "3.2 bps" / "—" — spread, honest dash when the book has no two-sided quote. */
export const fmtSpread = (v?: number): string => (v == null ? '—' : `${v.toFixed(1)} bps`)

// ── The client ───────────────────────────────────────────────────────────────

async function economyGet<T>(path: string): Promise<T> {
  const res = await fetch(`/v1/economy/${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = `Economy ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = String(body.error)
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status)
  }
  return (await res.json().catch(() => null)) as T
}

/**
 * Browser client for the Lux Economy dashboard. Reads the `dex` subgraph via the
 * session-gated, brand-scoped `/economy` proxy — the browser never touches the graph
 * host or composes a GraphQL query; the server owns the one allowlisted query.
 */
export const EconomyApi = {
  /** The economy snapshot (markets + recent fills + day history) for the brand's network. */
  async overview(): Promise<EconomySnapshot> {
    return economyGet<EconomySnapshot>('overview')
  },
}
