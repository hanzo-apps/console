/**
 * LivingOverview adapters — the pure maps from each REAL data source onto the
 * normalized `OverviewData` the tiles read. One adapter per source; each is a thin,
 * testable projection that fabricates nothing (a source with no data → empty maps,
 * so the tiles render honest skeletons/em-dashes).
 *
 * This is what makes the overview reusable across every product: the tiles + driver
 * never learn a specific endpoint — an adapter shapes the source, a config names the
 * tiles, and the SAME `LivingOverview` renders them. The adapters live here (pure)
 * and the configs bind them to a loader in `registry.ts`.
 *
 *   - `fromCloudUsage`   ← `CloudUsageOverview` (commerce usage ledger; the platform
 *                          overview + AI-usage products).
 *   - `fromAdminOverview`← `AdminOverview` (the `/v1/admin/*` aggregate).
 *   - `fromFunctions`    ← `FunctionsApi` list + metrics (the Functions product).
 *   - `healthFromApps`   ← `PlatformApp[]` (operator inventory → the health tile),
 *                          composable INTO any of the above.
 */
import type { CloudUsageOverview } from '@hanzo/usage'
import type { AdminOverview } from '~/lib/api/admin-overview'
import type { Finance } from '~/lib/api/finance'
import type { PlatformApp } from '~/lib/api/platform'
import type { ServerlessFunction, FunctionsMetrics, OverviewStats } from '~/lib/api/functions'
import type { EconomySnapshot } from '~/lib/api/economy'
import type { MakerStatus } from '~/lib/api/trading'
import type { OverviewData, OverviewEvent, OverviewHealth, OverviewPoint } from './config'

const empty = (): OverviewData => ({ kpi: {}, series: {}, distribution: {}, activity: [], alerts: [], health: [] })

/**
 * The usage overview BOTH real sources produce: the canonical `@hanzo/usage`
 * `CloudUsageOverview` (what cloud's `GET /v1/ai/usages/cloud` returns), OPTIONALLY
 * carrying the `byStatus` requests-by-status slice the console's commerce-ledger
 * adapter (`~/lib/api/usage`, over `/billing/usage`) additionally computes. Typing
 * `byStatus` optional lets the ONE `fromCloudUsage` map BOTH — the cloud aggregate
 * (no `byStatus`) and the ledger rollup (with it) — so neither source needs a fork.
 */
type UsageOverview = CloudUsageOverview & { byStatus?: { status: string; requests: number }[] }

/** Title-case a recorded status for the status donut legend (`success` → `Success`). */
const labelStatus = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown')

/** Map the cloud usage overview (the platform/AI-usage source) onto `OverviewData`. */
export function fromCloudUsage(ov: UsageOverview): OverviewData {
  const d = empty()
  d.kpi.tokens = { value: ov.totals.tokens, prior: ov.deltas.tokens?.prior, series: ov.series.map((p) => p.tokens) }
  d.kpi.spendCents = { value: ov.totals.spendCents, prior: ov.deltas.spendCents?.prior, series: ov.series.map((p) => p.spendCents) }
  d.kpi.requests = { value: ov.totals.requests, prior: ov.deltas.requests?.prior, series: ov.series.map((p) => p.requests) }
  d.kpi.models = { value: ov.totals.models, prior: ov.deltas.models?.prior, series: ov.series.map((p) => p.models) }

  d.series.tokens = { interval: ov.interval, points: ov.series.map((p) => ({ t: p.t, value: p.tokens })) }
  d.series.spendCents = { interval: ov.interval, points: ov.series.map((p) => ({ t: p.t, value: p.spendCents })) }
  d.series.requests = { interval: ov.interval, points: ov.series.map((p) => ({ t: p.t, value: p.requests })) }

  d.distribution.byModel = [
    ...ov.byModel.items.map((m) => ({ label: m.model, value: m.spendCents, sub: m.provider })),
    ...(ov.byModel.other ? [{ label: `Other (${ov.byModel.other.modelCount})`, value: ov.byModel.other.spendCents, sub: 'remaining models' }] : []),
  ]

  // Top models by TOKENS (the same real per-model rollup, valued on tokens instead of
  // spend) — the Metrics dashboard's "Top Models by Usage" donut. Zero-token models
  // drop out at the tile (positive-only), so an all-untokenized ledger → honest empty.
  d.distribution.byModelTokens = [
    ...ov.byModel.items.map((m) => ({ label: m.model, value: m.tokens, sub: m.provider })),
    ...(ov.byModel.other ? [{ label: `Other (${ov.byModel.other.modelCount})`, value: ov.byModel.other.tokens, sub: 'remaining models' }] : []),
  ]

  // Requests by recorded status (Success/Error/…) — the Metrics dashboard's status donut.
  // Only the commerce-ledger source carries it; the cloud aggregate omits it (honest empty).
  d.distribution.byStatus = (ov.byStatus ?? []).map((s) => ({ label: labelStatus(s.status), value: s.requests }))

  d.activity = ov.activity.items.map(
    (r): OverviewEvent => ({
      id: r.requestId || `${r.time}-${r.model}-${r.user}`,
      time: r.time,
      title: r.model ? `Inference · ${r.model}` : 'Inference',
      subtitle: [r.provider, r.tokens ? `${r.tokens.toLocaleString()} tokens` : ''].filter(Boolean).join(' · ') || undefined,
      status: r.status || 'success',
    }),
  )
  d.activityTotal = ov.activity.total
  return d
}

/** Map the `/v1/admin/*` aggregate onto `OverviewData`. */
export function fromAdminOverview(ov: AdminOverview): OverviewData {
  const d = empty()
  for (const k of ov.kpis) {
    const kpi: { value: number; prior?: number; series?: number[] } = { value: k.value }
    if (k.prior !== undefined) kpi.prior = k.prior
    if (k.series) kpi.series = k.series
    d.kpi[k.key] = kpi
  }
  for (const s of ov.series) d.series[s.key] = { interval: s.interval, points: s.points }
  const toSlices = (slices: { label: string; value: number; hint?: string }[]) =>
    slices.map((s) => ({ label: s.label, value: s.value, sub: s.hint }))
  if (ov.distribution.length) d.distribution.revenue = toSlices(ov.distribution)
  // Named business distributions (revenue by product, plan mix, top agents/bots by
  // cost, …) — each keyed exactly as the backend named it, so the business board's
  // tiles read them by that key. Never overwrites a slice the backend didn't send.
  if (ov.distributions) {
    for (const [key, slices] of Object.entries(ov.distributions)) {
      if (slices.length) d.distribution[key] = toSlices(slices)
    }
  }
  d.activity = ov.activity.map((a): OverviewEvent => ({ id: a.id, time: a.time, title: a.title, subtitle: a.subtitle, status: a.status }))
  d.alerts = ov.alerts.map((a) => ({ id: a.id, severity: a.severity, title: a.title, detail: a.detail }))
  d.health = ov.health.map((h): OverviewHealth => ({ service: h.service, health: h.health, detail: h.detail }))
  return d
}

/**
 * The finance board's single health verdict, from the derived profitability:
 *   - green  → profitable (revenue ≥ cost) with a healthy margin.
 *   - yellow → profitable but THIN (margin under 20%) — earning, but barely.
 *   - red    → burning faster than earning (cost > revenue, negative margin).
 * Pure so the health tile's color is unit-tested, not eyeballed. When DO cost is
 * unconfigured we can't judge margin honestly, so the verdict is unknown (''), which
 * the tile renders as "not connected" — never a fabricated green.
 */
export function financeHealth(fin: Finance): OverviewHealth {
  if (!fin.cost.configured) {
    return { service: 'Profitability', health: '', detail: 'Connect commerce to compute COGS + margin' }
  }
  const { profitable, grossMarginPct } = fin.derived
  if (!profitable) {
    return { service: 'Profitability', health: 'red', detail: 'Burning faster than earning' }
  }
  if (grossMarginPct < 20) {
    return { service: 'Profitability', health: 'yellow', detail: 'Thin margin (under 20%)' }
  }
  return { service: 'Profitability', health: 'green', detail: 'Profitable' }
}

/**
 * Map the `/v1/admin/finance` aggregate onto `OverviewData`. Every tile reads its
 * slice by key; a missing/unconfigured source degrades to an honest empty tile
 * (em-dash / "not connected"), NEVER a fabricated credit, MRR, or margin.
 */
export function fromFinance(fin: Finance): OverviewData {
  const d = empty()
  const cost = fin.cost
  const doCost = cost.digitalocean

  // ── KPI tiles.
  // COGS (all vendors) is the headline spend AND the margin basis — the aggregate's
  // own `cost` slice. Only when configured, so an unreachable commerce renders "—".
  if (cost.configured) {
    d.kpi.spendCents = { value: cost.totalCents }
  }
  // DO promo-credit remaining is the orthogonal treasury view — only when DO is on.
  if (doCost.configured) {
    d.kpi.creditRemaining = { value: doCost.creditRemainingCents }
  }
  if (fin.revenue.configured) {
    d.kpi.mrr = { value: fin.revenue.mrrCents }
    d.kpi.revenue = { value: fin.revenue.totalRevenueCents }
  }
  // Margin is meaningful when COGS (commerce) AND revenue are both real — it no
  // longer depends on DO, so a missing DO_API_TOKEN never blanks the margin.
  if (cost.configured && fin.revenue.configured) {
    d.kpi.marginPct = { value: fin.derived.grossMarginPct }
  }
  if (fin.derived.runwayDays !== null) {
    d.kpi.runwayDays = { value: fin.derived.runwayDays }
  }

  // ── COGS by vendor (donut): what we pay each vendor (DigitalOcean compute + each
  // LLM provider we resell). Positive lines only — a 0/pending-estimated vendor is
  // dropped so the donut isn't padded; an empty set renders the honest empty donut.
  if (cost.configured) {
    d.distribution.vendorCogs = cost.vendors
      .filter((v) => v.amountCents > 0)
      .map((v) => ({ label: v.vendor, value: v.amountCents, sub: v.service }))
  }

  // ── Credit burn-down series: the DO usage charges over time (Invoice entries),
  // oldest→newest. Only usage-side (positive) charges shape the burn-down; credit
  // grants (negative) are excluded so the series reads as "spend over time".
  const charges = doCost.history
    .filter((h) => h.amountCents > 0)
    .slice()
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  if (charges.length) {
    d.series.spendCents = { interval: 'day', points: charges.map((h) => ({ t: h.date, value: h.amountCents })) }
  }

  // ── Single health tile: the profitability verdict.
  d.health = [financeHealth(fin)]
  return d
}

/**
 * Sum every per-function line of a metrics series into one dense "total over time"
 * series, keyed + ordered by timestamp. Pure — reused by the Functions adapter.
 */
export function sumSeriesLines(series: FunctionsMetrics['series']): OverviewPoint[] {
  const byT = new Map<string, number>()
  for (const line of series) {
    for (const p of line.points) byT.set(p.t, (byT.get(p.t) ?? 0) + (Number.isFinite(p.v) ? p.v : 0))
  }
  return Array.from(byT.entries())
    .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
    .map(([t, value]) => ({ t, value }))
}

/**
 * Map the Functions product's real inventory + metrics onto `OverviewData`. The KPI
 * values come from `deriveOverview` (already the product's honest rollup); the series
 * + status distribution from `FunctionsApi.metrics` (null → empty maps, honest states).
 */
export function fromFunctions(stats: OverviewStats, metrics: FunctionsMetrics | null): OverviewData {
  const d = empty()
  d.kpi.functions = { value: stats.count }
  if (stats.invocations7d !== null) {
    const invSeries = metrics ? sumSeriesLines(metrics.series).map((p) => p.value) : undefined
    const kpi: { value: number; prior?: number; series?: number[] } = { value: stats.invocations7d }
    if (invSeries && invSeries.length >= 2) kpi.series = invSeries
    d.kpi.invocations = kpi
  }
  if (stats.successRate !== null) d.kpi.success = { value: Math.round(stats.successRate * 100) }
  if (stats.avgDurationMs !== null) d.kpi.duration = { value: stats.avgDurationMs }
  if (stats.errors7d !== null) d.kpi.errors = { value: stats.errors7d }

  if (metrics && metrics.series.length) {
    const points = sumSeriesLines(metrics.series)
    // The metrics grid points are hourly for short ranges; the axis formats either way.
    if (points.length) d.series.invocations = { interval: 'hour', points }
  }
  if (metrics) {
    const { success, timeout, error } = metrics.status
    if (success + timeout + error > 0) {
      d.distribution.status = [
        { label: 'Success', value: success },
        { label: 'Timeout', value: timeout },
        { label: 'Error', value: error },
      ]
    }
  }
  return d
}

/**
 * Project the operator apps inventory into health rows — composable into any
 * overview's health tile. Dedupes to one row per app (the latest observation) and
 * keeps the real `health` verdict. Empty inventory → no rows (honest "not reporting").
 */
export function healthFromApps(apps: PlatformApp[]): OverviewHealth[] {
  const byApp = new Map<string, OverviewHealth>()
  for (const a of apps) {
    const key = a.app || a.id
    if (!key) continue
    byApp.set(key, { service: a.app || a.id, health: a.health, detail: a.cluster })
  }
  return Array.from(byApp.values()).sort((x, y) => x.service.localeCompare(y.service))
}

/** Counts of product/service health rows by verdict — the Overlord product board. */
export type HealthTally = { total: number; healthy: number; degraded: number; down: number; unknown: number }

/**
 * Tally a set of health rows by verdict — the platform-wide "how many products are
 * up/down" count for the Overlord god-view KPIs. `green` → healthy, `yellow` →
 * degraded, `red` → down, anything else (incl. '') → unknown. Pure, so the
 * product-count KPIs are unit-tested, not eyeballed. An empty inventory → all zeros
 * (the tile renders an honest em-dash, never a fabricated "all healthy").
 */
export function healthTally(rows: OverviewHealth[]): HealthTally {
  const t: HealthTally = { total: 0, healthy: 0, degraded: 0, down: 0, unknown: 0 }
  for (const r of rows) {
    t.total += 1
    const v = String(r.health).toLowerCase()
    if (v === 'green') t.healthy += 1
    else if (v === 'yellow') t.degraded += 1
    else if (v === 'red') t.down += 1
    else t.unknown += 1
  }
  return t
}

/** Distinct non-empty orgs represented in the operator inventory (platform tenancy). */
export function orgsFromApps(apps: PlatformApp[]): string[] {
  const set = new Set<string>()
  for (const a of apps) if (a.org) set.add(a.org)
  return Array.from(set).sort()
}

/**
 * The Overlord (admin.hanzo.ai) god-view of EVERYTHING — the platform-wide overview
 * that composes THREE real sources into one board, so the top of admin.hanzo.ai
 * answers "is the whole platform healthy, how many orgs, and what is it costing/
 * earning" in one glance:
 *
 *   - `apps` (operator inventory, `PlatformApi.apps()`): the platform-wide PRODUCT
 *     HEALTH board — every deployed Hanzo product/service and its real up/down
 *     verdict, plus the distinct-org count. This is the centerpiece the CTO asked
 *     for (products + live health across ALL orgs).
 *   - `admin` (the `/v1/admin/overview` all-orgs aggregate) when routed: platform
 *     usage/spend KPIs + timeseries + top-models distribution + live activity +
 *     alerts. OPTIONAL — null when the aggregate isn't routed on this host.
 *   - `usage` (the real commerce usage ledger, all-orgs) as the HONEST FALLBACK
 *     source for the usage/spend KPIs + activity when the admin aggregate is absent,
 *     so the board is never blank. OPTIONAL — null when even that can't be read.
 *
 * Every tile degrades to its honest empty state when its slice has no real data —
 * NEVER a fabricated product, health verdict, org count, or spend figure. The
 * product-health board (from `apps`) is the one slice that is always real when the
 * operator inventory is reachable, so the god-view is meaningful even with no
 * aggregate + no ledger.
 */
export function fromOverlord(apps: PlatformApp[], admin: AdminOverview | null, usage: UsageOverview | null): OverviewData {
  // Start from whichever richer source is available for the usage/spend KPIs +
  // series + activity + alerts (admin aggregate preferred, else the ledger, else
  // an empty shell). The product-health board is layered on top from `apps`.
  const d = admin ? fromAdminOverview(admin) : usage ? fromCloudUsage(usage) : empty()

  // ── Platform-wide product health (the centerpiece) — always from the live
  // operator inventory. This OVERRIDES any aggregate-provided health with the
  // real, complete per-app board (the aggregate's health list is a summary; the
  // inventory is authoritative + full).
  const health = healthFromApps(apps)
  if (health.length) d.health = health
  const tally = healthTally(d.health)

  // ── Product-count KPIs derived from the health tally — "how many products, how
  // many up/down". Only when the inventory reported something; otherwise the tiles
  // read honest em-dashes rather than a fabricated "0 products / all healthy".
  if (tally.total > 0) {
    d.kpi.products = { value: tally.total }
    d.kpi.healthy = { value: tally.healthy }
    // Degraded + down together = the count that needs attention.
    d.kpi.attention = { value: tally.degraded + tally.down }
  }

  // ── Active orgs — prefer the aggregate's own `orgs` KPI (a real tenant count
  // across the whole platform, incl. orgs with no running app); fall back to the
  // distinct orgs present in the operator inventory. Never fabricated.
  if (d.kpi.orgs === undefined) {
    const orgs = orgsFromApps(apps)
    if (orgs.length) d.kpi.orgs = { value: orgs.length }
  }

  // ── The product-health board doubles as a distribution donut (by verdict) so the
  // god-view shows the healthy/degraded/down mix at a glance. Positive slices only.
  const mix = [
    { label: 'Healthy', value: tally.healthy },
    { label: 'Degraded', value: tally.degraded },
    { label: 'Down', value: tally.down },
    { label: 'Unknown', value: tally.unknown },
  ].filter((s) => s.value > 0)
  if (mix.length) d.distribution.productHealth = mix

  return d
}

/**
 * Map the Lux DEX indexer snapshot (+ the optional maker metrics) onto `OverviewData`
 * for the Lux Economy / Markets board (the DeFiLlama-style analytics plane). PURE.
 *
 * HONEST by construction to the `dex` subgraph's REAL surface (it is a CLOB, not an
 * AMM): the KPIs + tables are 24h volume, trades, book depth, active markets, and the
 * best-bid/ask spread — all fields the subgraph actually exposes (`volume24h`,
 * `tradeCount`, `remaining`, `bestBid`/`bestAsk`). It does NOT invent a pooled `tvlUSD`
 * (a CLOB has book DEPTH, not locked TVL); the day-history series is populated ONLY
 * when the subgraph's `MarketDayData` producer is emitting (today it is registered but
 * unproduced → the series tile shows its honest empty state, never a fabricated trend).
 *
 * The maker's live :2112 metrics (when reachable) add the maker-specific spread + a
 * "book making" health row — the analytics plane's link to the deploy/manage plane.
 */
export function fromLuxIndexer(snap: EconomySnapshot | null, maker?: MakerStatus | null): OverviewData {
  const d = empty()
  if (!snap || snap.status !== 'reporting') {
    // Honest empty — the tiles render em-dashes + "not reporting". The board's own
    // loader attaches an alert with the upstream error so the state is explained.
    if (snap?.error) d.alerts = [{ id: 'economy-down', severity: 'warning', title: 'DEX indexer not reporting', detail: snap.error }]
    return d
  }

  const markets = snap.markets
  const active = markets.length
  const withVol = markets.filter((m) => m.volume24h != null)
  const totalVol = withVol.reduce((s, m) => s + (m.volume24h ?? 0), 0)
  const totalTrades = markets.reduce((s, m) => s + (m.tradeCount ?? 0), 0)
  const totalDepth = markets.reduce((s, m) => s + (m.bookDepth ?? 0), 0)
  const totalOrders = markets.reduce((s, m) => s + (m.openOrders ?? 0), 0)

  // KPI tiles — only set a tile when the source genuinely has the datum, so a missing
  // field renders its honest em-dash rather than a fabricated 0.
  d.kpi.markets = { value: active }
  if (withVol.length) d.kpi.volume24h = { value: totalVol }
  if (markets.some((m) => m.tradeCount != null)) d.kpi.trades = { value: totalTrades }
  if (markets.some((m) => m.bookDepth != null)) d.kpi.bookDepth = { value: totalDepth }
  if (markets.some((m) => m.openOrders != null)) d.kpi.openOrders = { value: totalOrders }

  // Distribution donuts — volume + trades by market (positive slices only).
  const volSlices = withVol
    .map((m) => ({ label: m.symbol, value: m.volume24h ?? 0 }))
    .filter((s) => s.value > 0)
  if (volSlices.length) d.distribution.volumeByMarket = volSlices
  const tradeSlices = markets
    .map((m) => ({ label: m.symbol, value: m.tradeCount ?? 0 }))
    .filter((s) => s.value > 0)
  if (tradeSlices.length) d.distribution.tradesByMarket = tradeSlices
  // Book-depth split — the CLOB "liquidity" mix, honestly labeled as depth.
  const depthSlices = markets
    .map((m) => ({ label: m.symbol, value: m.bookDepth ?? 0 }))
    .filter((s) => s.value > 0)
  if (depthSlices.length) d.distribution.depthByMarket = depthSlices

  // Historical series — ONLY from real MarketDayData (unproduced today → empty tile,
  // never a fabricated trend). Sum volumeUSD (or raw volume) per day bucket.
  if (snap.dayData.length) {
    const byDay = new Map<number, { vol: number; hasVol: boolean; tvl: number; hasTvl: boolean }>()
    for (const p of snap.dayData) {
      const cur = byDay.get(p.date) ?? { vol: 0, hasVol: false, tvl: 0, hasTvl: false }
      if (p.volumeUSD != null) {
        cur.vol += p.volumeUSD
        cur.hasVol = true
      }
      if (p.tvlUSD != null) {
        cur.tvl += p.tvlUSD
        cur.hasTvl = true
      }
      byDay.set(p.date, cur)
    }
    const days = [...byDay.entries()].sort((a, b) => a[0] - b[0])
    const volPts: OverviewPoint[] = days.filter(([, v]) => v.hasVol).map(([date, v]) => ({ t: new Date(date * 1000).toISOString(), value: v.vol }))
    const tvlPts: OverviewPoint[] = days.filter(([, v]) => v.hasTvl).map(([date, v]) => ({ t: new Date(date * 1000).toISOString(), value: v.tvl }))
    if (volPts.length) d.series.volume24h = { interval: 'day', points: volPts }
    if (tvlPts.length) d.series.tvl = { interval: 'day', points: tvlPts }
  }

  // Activity — recent fills (settled trades), newest first, capped for the feed.
  d.activity = snap.trades.slice(0, 40).map((t) => ({
    id: t.id,
    time: t.timeMs != null ? new Date(t.timeMs).toISOString() : '',
    title: `${t.symbol}${t.side ? ` · ${t.side}` : ''}`,
    subtitle: [t.size != null ? `size ${t.size}` : null, t.price != null ? `@ ${t.price}` : null].filter(Boolean).join(' ') || undefined,
    status: t.side === 'buy' ? 'success' : t.side === 'sell' ? 'warn' : '',
  }))
  d.activityTotal = snap.trades.length

  // Maker health — the analytics plane's link to the deploy/manage plane.
  if (maker && maker.status === 'reporting') {
    d.health = [
      {
        service: 'Market maker',
        health: 'green',
        detail: `pegging ${maker.symbols.length} market(s)${maker.requotes != null ? ` · ${maker.requotes} requotes` : ''}`,
      },
    ]
    // Surface the maker's tightest per-symbol peg as a "maker spread" KPI proxy, when
    // reported (0 on a testnet luxd that lacks the 0x9999 read selectors — honest).
    const pegs = maker.symbols.map((s) => s.pegErrorBps).filter((v): v is number => v != null)
    if (pegs.length) d.kpi.makerPegBps = { value: Math.max(...pegs.map((p) => Math.abs(p))) }
  }

  return d
}
