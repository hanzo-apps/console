/**
 * TradingApi — the live-data client for the Trading module. TWO transports, one
 * concern each, both same-origin + session-gated:
 *
 *  1. The DEPLOYED BOT FLEET is read through the existing `PaasApi` (`/v1`
 *     bearer proxy → cloud `/v1/platform/*`): the org's PaaS apps, filtered to the
 *     maker/trader images by `templateForImage`. The console never re-derives the
 *     app list — it reuses the one PaaS surface, so deploy/start/stop/logs are the
 *     SAME control plane the Compute › Applications page uses.
 *
 *  2. The LIVE STATE (maker metrics + the DEX order book) is read through
 *     console2's OWN `/v1/trading` proxy (`app/v1/trading/[...path]/route.ts`), mirroring
 *     `/nodes`: session-gated, brand-scoped, method-allowlisted. The browser sends
 *     only its session cookie; the server scrapes the in-cluster maker `:2112`
 *     `/metrics` and queries the DEX RPC per brand-scoped network, returning
 *     NORMALIZED JSON. No cluster host or RPC method is ever chosen by the browser.
 *
 * Everything below `TradingApi` is PURE (no I/O): the Prometheus-text → metrics
 * and the DEX-response → order-book mappings are unit-tested against the real wire
 * shapes (trading.test.ts). Honest states only — a metric the maker does not report
 * is absent (never a fabricated 0), an unreachable network is `not-reporting`.
 */
import { ApiError } from './client'
import type { NodeNetworkId } from '~/lib/products/brand-scope'

// ── Bot fleet (view-model over PaasApi) ──────────────────────────────────────

/** One deployed bot, projected from a PaaS app + its matched template. */
export interface BotInstance {
  /** PaaS app id (the control-plane handle for start/stop/deploy/logs). */
  appId: string
  /** PaaS project slug/id the app lives in (needed for the app-scoped PaaS calls). */
  project: string
  /** App name/slug. */
  name: string
  slug: string
  /** Which bot template this app is an instance of. */
  template: 'market-maker' | 'trader'
  /** The image repository (ghcr.io/luxfi/maker | trader). */
  image: string
  /** Running tag/digest, when known. */
  tag?: string
  /** PaaS lifecycle: draft | building | deploying | live | stopped | error. */
  status: string
  /** Live operator health verdict (green/yellow/red), when the app reports one. */
  health?: string
  /** The app's environment (staging/production → testnet/mainnet). */
  environment?: string
  /** The deployed network id, when derivable from env/environment. */
  network?: string
}

// ── Maker metrics (Prometheus scrape) ────────────────────────────────────────

/** A per-symbol quote-quality reading, derived from the maker's live metrics. */
export interface SymbolMetric {
  /** The market symbol (e.g. "LETH/LUX"). */
  symbol: string
  /** Last book-mid tracking error vs the CEX mid, in bps (real; 0 is a real 0). */
  pegErrorBps?: number
  /** Median |tracking error| over the run, in bps. */
  pegP50Bps?: number
  /** p99 |tracking error| over the run, in bps. */
  pegP99Bps?: number
  /** Last realized fill price vs the CEX mid, in bps (present only after a probe fill). */
  realizedErrorBps?: number
}

/** The maker's live status — service counters + per-symbol quote quality. */
export interface MakerStatus {
  /** `reporting` = the :2112 metrics answered; `not-reporting` = unreachable/errored. */
  status: 'reporting' | 'not-reporting'
  /** Present when `not-reporting` — the real upstream error (never fabricated data). */
  error?: string
  /** Service uptime (seconds), when reported. */
  uptimeSeconds?: number
  /** Two-sided book re-pegs to the CEX mid. */
  requotes?: number
  /** Corrective arb swaps when the book drifted past the band. */
  arbs?: number
  /** Taker probe trades issued. */
  probes?: number
  /** Settled DEXFills measured. */
  fills?: number
  /** Reference/peg errors (skipped cycles). */
  errors?: number
  /** Cumulative base-fee burn (LUX) at the 25 gwei floor. */
  burnLux?: number
  /** Per-symbol quote quality (the markets the maker is making). */
  symbols: SymbolMetric[]
}

/**
 * Parse the maker's Prometheus text exposition (`coherence_*`) into `MakerStatus`.
 * PURE. Only the maker's own metric names are read; an unknown line is ignored, a
 * missing metric stays absent (never a fabricated value). Per-symbol gauges carry a
 * `{symbol="…"}` label; scalar counters/gauges carry none.
 */
export function parseMakerMetrics(text: string): Omit<MakerStatus, 'status' | 'error'> {
  const scalars: Record<string, number> = {}
  const bySymbol = new Map<string, SymbolMetric>()

  const symbolOf = (labels: string): string | null => {
    const m = /symbol="([^"]*)"/.exec(labels)
    return m ? m[1] : null
  }
  const ensure = (sym: string): SymbolMetric => {
    let s = bySymbol.get(sym)
    if (!s) {
      s = { symbol: sym }
      bySymbol.set(sym, s)
    }
    return s
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // `coherence_<name>[{labels}] <value>`
    const m = /^(coherence_[a-z0-9_]+)(\{[^}]*\})?\s+([-+0-9.eE]+)$/.exec(line)
    if (!m) continue
    const name = m[1]
    const labels = m[2] ?? ''
    const value = Number(m[3])
    if (!Number.isFinite(value)) continue

    if (labels) {
      const sym = symbolOf(labels)
      if (!sym) continue
      const s = ensure(sym)
      if (name === 'coherence_peg_error_bps') s.pegErrorBps = value
      else if (name === 'coherence_peg_error_p50_bps') s.pegP50Bps = value
      else if (name === 'coherence_peg_error_p99_bps') s.pegP99Bps = value
      else if (name === 'coherence_realized_error_bps') s.realizedErrorBps = value
    } else {
      scalars[name] = value
    }
  }

  const symbols = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
  const num = (k: string): number | undefined => (k in scalars ? scalars[k] : undefined)
  return {
    uptimeSeconds: num('coherence_uptime_seconds'),
    requotes: num('coherence_requotes_total'),
    arbs: num('coherence_arbs_total'),
    probes: num('coherence_probes_total'),
    fills: num('coherence_fills_total'),
    errors: num('coherence_errors_total'),
    burnLux: num('coherence_burn_lux'),
    symbols,
  }
}

// ── DEX order book ───────────────────────────────────────────────────────────

/** One resting order on the DEX book. */
export interface BookOrder {
  /** On-chain order id. */
  orderId: number
  /** Settlement account (hex). */
  user: string
}

/** An order-book snapshot for one market, as the `/trading` proxy returns it. */
export interface OrderBook {
  network: NodeNetworkId
  /** The market symbol requested (e.g. "LETH/LUX"), echoed back. */
  symbol?: string
  /** The 32-byte poolId (hex) the book was read at, when known. */
  poolId?: string
  /** `reporting` = the DEX answered; `not-reporting` = the D-Chain/RPC was unreachable. */
  status: 'reporting' | 'not-reporting'
  /** Present when `not-reporting` — the real upstream error. */
  error?: string
  /** Resting orders on the book (the D-Chain CLOB `dex_get_orders` read). */
  orders: BookOrder[]
}

/** Raw resting order as the `dex_get_orders` endpoint returns it. */
export interface RawBookOrder {
  orderId?: number
  user?: string
  [k: string]: unknown
}

/** Normalize `dex_get_orders` → book orders. PURE. Drops rows with no order id. */
export function normalizeBook(raw: RawBookOrder[] | undefined): BookOrder[] {
  return (raw ?? [])
    .filter((o): o is RawBookOrder & { orderId: number } => typeof o.orderId === 'number')
    .map((o) => ({ orderId: o.orderId, user: typeof o.user === 'string' ? o.user : '' }))
}

// ── Formatting helpers (PURE) ────────────────────────────────────────────────

/** "3.2 bps" / "—" — a bps reading, honest dash when the maker reports none. */
export const fmtBps = (v?: number): string => (v == null ? '—' : `${v.toFixed(1)} bps`)

/** "1,204" / "—" — a counter, honest dash when unknown (0 is a real 0). */
export const fmtCount = (v?: number): string => (v == null ? '—' : Math.round(v).toLocaleString())

/** "0.0042 LUX" / "—" — cumulative burn, honest dash when unknown. */
export const fmtBurn = (v?: number): string => (v == null ? '—' : `${v.toFixed(4)} LUX`)

/** "2h 14m" / "—" — uptime, honest dash when unknown. */
export function fmtUptime(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

// ── The client ───────────────────────────────────────────────────────────────

async function tradingGet<T>(path: string): Promise<T> {
  const res = await fetch(`/v1/trading/${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = `Trading ${res.status}`
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
 * Browser client for the Trading live-data proxy. The bot FLEET is read via
 * `PaasApi` (see TradingModule); this client is only the maker metrics + the DEX
 * book, which the PaaS does not have.
 */
export const TradingApi = {
  /** The live maker status (service counters + per-symbol quote quality) for a network. */
  async makerStatus(network: NodeNetworkId, service?: string): Promise<MakerStatus> {
    const qs = new URLSearchParams({ network })
    if (service) qs.set('service', service)
    return tradingGet<MakerStatus>(`metrics?${qs.toString()}`)
  },

  /** The DEX order book for a market (symbol OR base+quote) on a network. */
  async orderbook(network: NodeNetworkId, opts: { symbol?: string; base?: string; quote?: string }): Promise<OrderBook> {
    const qs = new URLSearchParams({ network })
    if (opts.symbol) qs.set('symbol', opts.symbol)
    if (opts.base) qs.set('base', opts.base)
    if (opts.quote) qs.set('quote', opts.quote)
    return tradingGet<OrderBook>(`orderbook?${qs.toString()}`)
  },
}
