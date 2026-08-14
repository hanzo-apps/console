/**
 * Living-overview registry — the DECLARATIVE catalog of which products have a
 * living overview and how each is configured. Adding a product's overview is one
 * entry here: name its tiles + point its `load` at a REAL source (via an adapter).
 * No overview UI is written per product — the SAME `LivingOverview` renders them.
 *
 * ```ts
 * // add a new product overview — this is the whole pattern:
 * myproduct: {
 *   id: 'myproduct',
 *   title: 'My Product',
 *   subtitle: '…',
 *   live: { pollMs: 15000 },              // videogame layer (throttled + tab-paused)
 *   rows: [
 *     [{ tile: 'metric', key: 'foo', label: 'Foo', icon: Zap }],
 *     [{ tile: 'timeseries', key: 'foo', title: 'Foo over time' },
 *      { tile: 'distribution', key: 'bar', title: 'By kind' }],
 *     [{ tile: 'activity' }, { tile: 'health' }],
 *   ],
 *   load: async ({ range }) => fromMyApi(await MyApi.overview(range)),  // REAL data
 * }
 * ```
 *
 * The tile `key`s must match the keys the adapter writes into `OverviewData` — a
 * mismatch renders an honest empty tile (never a crash), so over-declaring a tile a
 * slow backend hasn't filled yet is safe.
 */
import { Activity, ArrowLeftRight, BarChart3, Boxes, Building2, Coins, Cpu, CreditCard, DollarSign, FunctionSquare, Gauge, Hash, HeartPulse, Layers, LineChart, Timer, TrendingUp, TriangleAlert, Users } from '@hanzogui/lucide-icons-2'

import { UsageApi } from '~/lib/api/usage'
import { CloudUsageApi } from '~/lib/api/cloud-usage'
import { AdminApi, type AdminOverview } from '~/lib/api/admin-overview'
import { FinanceApi } from '~/lib/api/finance'
import { PlatformApi } from '~/lib/api/platform'
import { FunctionsApi, deriveOverview } from '~/lib/api/functions'
import { EconomyApi } from '~/lib/api/economy'
import { TradingApi } from '~/lib/api/trading'
import type { CloudUsageOverview } from '~/lib/api/usage'
import type { LivingOverviewConfig, OverviewData, OverviewRange } from './config'
import { fromAdminOverview, fromCloudUsage, fromFinance, fromFunctions, fromLuxIndexer, fromOverlord, healthFromApps } from './adapters'

/** The cloud-usage range key the commerce ledger adapter expects (identical set). */
const usageRange = (r: OverviewRange): '24h' | '7d' | '30d' => r
/** Functions metrics uses upper-case range codes. */
const fnRange = (r: OverviewRange): '24H' | '7D' | '30D' => (r === '24h' ? '24H' : r === '7d' ? '7D' : '30D')

/**
 * Best-effort health enrichment: probe the operator apps inventory and attach the
 * health rows. A failure (PaaS token unset → 501, or unrouted) leaves health empty
 * so the tile shows its honest "not reporting" state — the rest of the board still
 * renders. NEVER throws into the caller.
 */
async function withHealth(data: OverviewData, probeApps = true): Promise<OverviewData> {
  // The fleet inventory (`/v1/platform/fleet`) is admin-gated on this deployment, so a
  // tenant user's probe only 403s — skip it and leave health in its honest empty
  // state instead of firing a request we know will be rejected (keeps the browser
  // console clean). Super admins (probeApps=true, the default) still enrich health.
  if (!probeApps) return data
  try {
    // Service-token-gated + tenant-scoped server-side, so no org filter from the browser.
    const apps = await PlatformApi.apps()
    data.health = healthFromApps(apps)
  } catch {
    /* honest empty health */
  }
  return data
}

/**
 * The platform/admin living overview. Primary source is the `/v1/admin/overview`
 * aggregate; when that backend isn't routed (404) we fall back to the REAL commerce
 * usage ledger + operator health that every deployment already serves, so the
 * centerpiece is never blank. All real, no mocks.
 */
const platformOverview: LivingOverviewConfig = {
  id: 'overview',
  title: 'Overview',
  subtitle: 'Real-time usage, performance, and spend across your AI workloads.',
  live: { pollMs: 15000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'tokens', label: 'Inference tokens', icon: Hash },
      { tile: 'metric', key: 'spendCents', label: 'Spend', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'requests', label: 'Requests', icon: Activity },
      { tile: 'metric', key: 'models', label: 'Active models', icon: Layers },
    ],
    [
      { tile: 'timeseries', key: 'tokens', title: 'Inference tokens over time' },
      { tile: 'timeseries', key: 'spendCents', title: 'Spend over time', kind: 'bar', unit: 'cents' },
    ],
    [
      { tile: 'distribution', key: 'revenue', title: 'Spend by product', centerLabel: 'total', unit: 'cents' },
      { tile: 'alerts' },
    ],
    [{ tile: 'activity', title: 'Live activity' }, { tile: 'health', title: 'System health' }],
  ],
  load: async ({ range, allOrgs, isSuperAdmin }) => {
    // `/v1/admin/overview` is a cross-tenant aggregate, server-gated to global
    // admins. A tenant user (even an org's OWN admin, e.g. `hanzo/z`) only ever
    // gets a 403 from it, so don't fire it for them — go straight to the org-scoped
    // usage ledger (the same source the catch-fallback already used). This keeps a
    // tenant admin's overview working AND silent, instead of spamming the browser
    // console with 403s for a call that can't succeed.
    if (isSuperAdmin) {
      try {
        const ov = await AdminApi.overview({ range, allOrgs, activityLimit: 40 })
        const data = fromAdminOverview(ov)
        // The admin aggregate carries health; only probe the operator if it didn't.
        return data.health.length ? data : withHealth(data)
      } catch {
        /* Admin backend not routed on this host → fall through to the usage ledger. */
      }
    }
    // Tenant user (or the admin aggregate was unavailable): the org's REAL usage from
    // cloud's NATIVE `GET /v1/get-cloud-usages` — the SAME source the AI Metrics board
    // (`AiUsageModule`) reads. It is org-scoped SERVER-SIDE and cookie-authed, so a
    // non-super-admin (even their OWN org's admin, e.g. `hanzo/z`) gets a 200 for THEIR
    // org and the board renders their real spend — NEVER an "Access required" card. It is
    // cloud-native, so it also works in the go:embed console that serves console.hanzo.ai;
    // the `/billing/usage` proxy is a Next route handler the static embed prunes (which is
    // why the prior fallback failed there). A 403 on the admin aggregate above has already
    // fallen through to here silently.
    const usage = await CloudUsageApi.overview(usageRange(range), {
      org: allOrgs ? 'all' : undefined,
      topModels: 6,
      activityLimit: 40,
    })
    const data = fromCloudUsage(usage)
    // Reuse the byModel breakdown as the "revenue"/spend donut on the fallback path.
    data.distribution.revenue = data.distribution.byModel ?? []
    // Skip the admin-gated apps probe for tenant users (→ honest empty health)
    // so it doesn't 403; global admins whose aggregate just failed still probe.
    return withHealth(data, isSuperAdmin)
  },
}

/**
 * The admin.hanzo.ai OVERLORD overview — the god-view of EVERYTHING. This is the
 * top-level admin dashboard the CTO asked for: a single board that answers, across
 * the WHOLE platform (all orgs, not one tenant), "is every product healthy, how many
 * orgs/tenants, and what is the platform-wide usage/spend + top models". GLOBAL-ADMIN
 * ONLY (catalog entry `admin: true` hides it from every customer; the loader is an
 * all-orgs god view and `/v1/admin/overview` is itself server-gated by getAdminGate).
 *
 * Distinct from the sibling admin boards — Business (MRR/revenue), Finance (margin/
 * runway), Bots/Machines (fleet). The Overlord's CENTERPIECE is the platform-wide
 * PRODUCT HEALTH board (every Hanzo product up/down from the REAL operator inventory)
 * plus platform tenancy + usage/revenue. It reuses the ONE `LivingOverview` — adding
 * it was a config + a pure adapter (`fromOverlord`), no new overview UI.
 *
 * THREE real sources, composed by `fromOverlord`, honest by construction:
 *   - operator inventory (`PlatformApi.apps()`) → the product-health board + product
 *     counts (products / healthy / needs-attention) + distinct-org count. ALWAYS real
 *     when the inventory is reachable — so the god-view is meaningful even with no
 *     aggregate and no ledger.
 *   - `/v1/admin/overview` (all-orgs) → usage/spend KPIs + timeseries + top-models +
 *     live activity + alerts, when routed.
 *   - the real commerce usage ledger (all-orgs) → the HONEST FALLBACK for the usage/
 *     spend KPIs + activity when the aggregate isn't routed, so the board is never
 *     blank. Business-only figures (MRR/revenue) are NOT shown here (that's the
 *     Business board) — the Overlord is the operational god-view, not the P&L.
 */
const overlordOverview: LivingOverviewConfig = {
  id: 'overlord',
  title: 'Overlord',
  subtitle: 'God-view of the whole platform — every product’s health, tenants, and usage across all orgs.',
  live: { pollMs: 20000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'products', label: 'Products', icon: Boxes },
      { tile: 'metric', key: 'healthy', label: 'Healthy', icon: HeartPulse },
      { tile: 'metric', key: 'attention', label: 'Needs attention', icon: TriangleAlert },
      { tile: 'metric', key: 'orgs', label: 'Active orgs', icon: Building2 },
    ],
    [
      { tile: 'metric', key: 'requests', label: 'Requests', icon: Activity },
      { tile: 'metric', key: 'tokens', label: 'Inference tokens', icon: Hash },
      { tile: 'metric', key: 'spendCents', label: 'Usage cost', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'models', label: 'Active models', icon: Layers },
    ],
    [
      { tile: 'timeseries', key: 'requests', title: 'Requests over time' },
      { tile: 'timeseries', key: 'spendCents', title: 'Usage cost over time', kind: 'bar', unit: 'cents' },
    ],
    [
      { tile: 'distribution', key: 'productHealth', title: 'Product health', centerLabel: 'products' },
      { tile: 'distribution', key: 'revenue', title: 'Spend by product', centerLabel: 'total', unit: 'cents' },
    ],
    [
      { tile: 'health', title: 'Every product — live health', empty: 'Product health appears once the operator inventory is reachable.' },
      { tile: 'alerts', title: 'Platform alerts' },
    ],
    [{ tile: 'activity', title: 'Live platform activity', empty: 'Platform activity appears here as it happens.' }],
  ],
  // God-view: ALWAYS all-orgs. Probe the three real sources independently so a
  // missing aggregate / ledger never blanks the board — the product-health board
  // (from the operator inventory) is the always-real centerpiece.
  load: async ({ range }) => {
    // 1) Operator inventory — the platform-wide product health board (+ org count).
    let apps: Awaited<ReturnType<typeof PlatformApi.apps>> = []
    try {
      apps = await PlatformApi.apps()
    } catch {
      /* honest empty product board — the health tile shows "not reporting" */
    }
    // 2) The all-orgs admin aggregate (usage/spend/top-models/activity), when routed.
    let admin: AdminOverview | null = null
    try {
      admin = await AdminApi.overview({ range, allOrgs: true, activityLimit: 40 })
    } catch {
      /* aggregate not routed here → fall back to the real usage ledger below */
    }
    // 3) The real commerce usage ledger (all-orgs) — the honest fallback for the
    // usage/spend KPIs + activity when the aggregate is absent. Skip the ledger call
    // entirely when the aggregate already gave us usage data (don't double-fetch).
    let usage: CloudUsageOverview | null = null
    if (!admin) {
      try {
        usage = await UsageApi.overview({ range: usageRange(range), activityType: 'all', activityLimit: 40, topModels: 6, allOrgs: true })
      } catch {
        /* no ledger either → usage KPIs render honest em-dashes; product board still real */
      }
    }
    return fromOverlord(apps, admin, usage)
  },
}

/**
 * The admin.hanzo.ai BUSINESS overview — the SaaS control board for running the
 * business: MRR/revenue, total usage & cost trend, active orgs/customers, top
 * agents/bots by cost, subscription/plan mix, and fleet health. GLOBAL-ADMIN ONLY
 * (gated by the registry `admin` flag + `useIsSuperAdmin`; the `/v1/admin/overview`
 * aggregate is itself server-gated). It is an all-orgs god view — the module always
 * passes `allOrgs`, and the loader forwards `?org=all`.
 *
 * Primary source is the `/v1/admin/overview` aggregate (IAM + commerce + o11y). When
 * that backend isn't routed on this host (404) it falls back to the REAL commerce
 * usage ledger + operator health every deployment already serves, so the board is
 * never blank — every business tile (revenue, orgs, plan mix, top agents) that the
 * fallback can't source renders its HONEST empty state, NEVER a fabricated number.
 */
const adminBusinessOverview: LivingOverviewConfig = {
  id: 'admin-business',
  title: 'Business',
  subtitle: 'MRR, revenue, usage & cost, customers, and top agents across the whole platform.',
  live: { pollMs: 30000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'mrr', label: 'MRR', icon: TrendingUp, unit: 'cents' },
      { tile: 'metric', key: 'revenue', label: 'Revenue', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'spendCents', label: 'Usage cost', icon: CreditCard, unit: 'cents' },
      { tile: 'metric', key: 'orgs', label: 'Active orgs', icon: Building2 },
      { tile: 'metric', key: 'customers', label: 'Customers', icon: Users },
    ],
    [
      { tile: 'timeseries', key: 'revenue', title: 'Revenue over time', kind: 'bar', unit: 'cents' },
      { tile: 'timeseries', key: 'spendCents', title: 'Usage cost over time', unit: 'cents' },
    ],
    [
      { tile: 'distribution', key: 'revenue', title: 'Revenue by product', centerLabel: 'total', unit: 'cents' },
      { tile: 'distribution', key: 'plans', title: 'Subscription / plan mix', centerLabel: 'plans' },
    ],
    [
      { tile: 'distribution', key: 'topAgents', title: 'Top agents & bots by cost', centerLabel: 'total', unit: 'cents' },
      { tile: 'alerts', title: 'Business alerts' },
    ],
    [
      { tile: 'activity', title: 'Live platform activity', empty: 'Platform activity appears here as it happens.' },
      { tile: 'health', title: 'Fleet health', empty: 'Service health appears once the operator reports.' },
    ],
  ],
  load: async ({ range }) => {
    try {
      const ov = await AdminApi.overview({ range, allOrgs: true, activityLimit: 40 })
      const data = fromAdminOverview(ov)
      return data.health.length ? data : withHealth(data)
    } catch {
      // Admin aggregate not routed here → the REAL usage ledger + operator health.
      // Business-only tiles (mrr/revenue/orgs/customers/plans/topAgents) stay
      // honest-empty; usage cost, activity, and health still render real data.
      const usage = await UsageApi.overview({
        range: usageRange(range),
        activityType: 'all',
        activityLimit: 40,
        topModels: 6,
        allOrgs: true,
      })
      return withHealth(fromCloudUsage(usage))
    }
  },
}

/**
 * The admin.hanzo.ai FINANCE board — the SaaS profitability hero. GLOBAL-ADMIN ONLY
 * (catalog entry `admin: true`; the `/v1/admin/finance` aggregate is server-gated by
 * `getAdminGate` before anything is forwarded). It answers "are we making money?":
 * how fast we're burning the ~$40k DigitalOcean promo credit (our primary venue),
 * month-to-date spend, MRR, total revenue, gross margin %, runway, and a single
 * health verdict (green profitable / yellow thin-margin / red burning-faster).
 *
 * TRUE by construction: every tile reads the real `/v1/admin/finance` aggregate.
 * When DO_API_TOKEN is unset the cost tiles + margin + runway render honest "—"
 * (never a fake $40k); when commerce is unreachable revenue/MRR render "—". There is
 * NO fallback that fabricates numbers — a not-routed/denied backend surfaces the
 * shared error/empty state, so the hero is always honest.
 */
const financeOverview: LivingOverviewConfig = {
  id: 'finance',
  title: 'Finance',
  subtitle: 'Vendor COGS (DigitalOcean + LLM providers), revenue, gross margin, DigitalOcean credit burn-down, and runway across the platform.',
  ranged: false, // the finance aggregate is a point-in-time snapshot, not a windowed series
  live: { pollMs: 60000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'spendCents', label: 'COGS (all vendors)', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'revenue', label: 'Total revenue', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'marginPct', label: 'Gross margin', icon: Gauge, unit: 'pct' },
      { tile: 'metric', key: 'mrr', label: 'MRR', icon: TrendingUp, unit: 'cents' },
      { tile: 'metric', key: 'creditRemaining', label: 'DO credit remaining', icon: CreditCard, unit: 'cents' },
      { tile: 'metric', key: 'runwayDays', label: 'Runway (days)', icon: Timer },
    ],
    [
      { tile: 'distribution', key: 'vendorCogs', title: 'COGS by vendor', centerLabel: 'total', unit: 'cents' },
      { tile: 'timeseries', key: 'spendCents', title: 'DigitalOcean credit burn-down', kind: 'bar', unit: 'cents' },
    ],
    [{ tile: 'health', title: 'Profitability', empty: 'Connect commerce /v1/costs to compute COGS + margin.' }, { tile: 'alerts', title: 'Finance alerts' }],
  ],
  // No try/catch fallback: finance is TRUE-by-construction. A denied (403)/not-routed
  // (404) backend throws a typed ApiError the ONE LivingOverview renders as an honest
  // error state — we never substitute a fabricated revenue/margin.
  load: async () => fromFinance(await FinanceApi.finance()),
}

/**
 * The AI-usage living overview for a product scoped to the org's inference.
 *
 * It reads the WAREHOUSE aggregate (`CloudUsageApi` → `/v1/ai/usages/cloud`), which
 * is the source that measures tokens. It used to read the commerce ledger
 * (`UsageApi` → `/v1/billing/usage`), whose records are `{amount, createdAt, decimal,
 * metadata, transactionId}` — the charged cost of record, carrying no token counts at
 * all. So the "Tokens" tile on this board could only ever say 0, and did, for a window
 * the warehouse measured in the millions. That is not a rollup this console can fix:
 * the number is absent from the source. Reading the source that HAS it is the fix, and
 * it is the same call the sibling AI Metrics product and the platform overview above
 * already make — one way to read usage, not three.
 *
 * `fromCloudUsage` maps both shapes (the ledger additionally computed `byStatus`, which
 * this board never rendered), so only the loader changes. The commerce ledger remains
 * the source for SPEND wherever spend is the question — billing is commerce, and this
 * board is about inference.
 */
const aiUsageOverview = (id: string, title: string, subtitle: string): LivingOverviewConfig => ({
  id,
  title,
  subtitle,
  live: { pollMs: 20000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'tokens', label: 'Tokens', icon: Hash },
      { tile: 'metric', key: 'requests', label: 'Requests', icon: Activity },
      { tile: 'metric', key: 'spendCents', label: 'Spend', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'models', label: 'Models', icon: Layers },
    ],
    [
      { tile: 'timeseries', key: 'requests', title: 'Requests over time' },
      { tile: 'distribution', key: 'byModel', title: 'Spend by model', centerLabel: 'total', unit: 'cents' },
    ],
    [{ tile: 'activity', title: 'Recent inference', empty: 'No inference calls in this range yet.' }],
  ],
  load: async ({ range, allOrgs }) =>
    fromCloudUsage(
      await CloudUsageApi.overview(usageRange(range), {
        org: allOrgs ? 'all' : undefined,
        topModels: 6,
        activityLimit: 40,
      }),
    ),
})

/**
 * The Open Edition (run-for-pay) living overview — the customer's view of what
 * their open-source workloads cost. It reads the SAME real commerce usage ledger
 * (`/v1/billing/usage`) as every other usage board, but scoped to the
 * run-for-pay product tag (`metadata.product = 'open-edition'`) via the ledger's
 * own client-side `product` filter — so the totals, spend-over-time, per-model
 * spend, and activity are all the org's REAL open-edition charges, never a mock.
 *
 * `spendCents` here IS the served-revenue figure `R` the pricing spec produces
 * (cost + 25% resell margin) and the settlement spec splits — the price already
 * billed as a commerce `Withdraw`. An org with no open-edition workloads yet rolls
 * up honest-empty (em-dashes + "no run-for-pay usage"), never a fabricated number.
 * Canonical model: docs/architecture/run-for-pay-pricing.md (price) +
 * run-for-pay-and-contributor-revenue.md (settlement).
 */
const openEditionOverview: LivingOverviewConfig = {
  id: 'open-edition',
  title: 'Open Edition',
  subtitle: 'Run open-source workloads for pay — tokens run, spend billed (cost + 25%), and per-model usage for your org.',
  live: { pollMs: 20000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'tokens', label: 'Tokens run', icon: Hash },
      { tile: 'metric', key: 'requests', label: 'Requests', icon: Activity },
      { tile: 'metric', key: 'spendCents', label: 'Spend billed', icon: DollarSign, unit: 'cents', caption: 'cost + 25% margin' },
      { tile: 'metric', key: 'models', label: 'OSS models', icon: Layers },
    ],
    [
      { tile: 'timeseries', key: 'spendCents', title: 'Spend over time', kind: 'bar', unit: 'cents' },
      { tile: 'distribution', key: 'byModel', title: 'Spend by model', centerLabel: 'total', unit: 'cents' },
    ],
    [{ tile: 'activity', title: 'Recent run-for-pay usage', empty: 'No run-for-pay (open-edition) usage in this range yet.' }],
  ],
  // Same real ledger, scoped to the run-for-pay product tag client-side (never
  // widens scope): a product with no attributed rows rolls up honest-empty.
  load: async ({ range, allOrgs }) =>
    fromCloudUsage(
      await UsageApi.overview({
        range: usageRange(range),
        activityType: 'all',
        activityLimit: 40,
        topModels: 6,
        allOrgs,
        product: 'open-edition',
      }),
    ),
}

/** The Functions product living overview — real inventory + metrics. */
const functionsOverview: LivingOverviewConfig = {
  id: 'functions',
  title: 'Functions',
  subtitle: 'Event-driven serverless functions — invocations, latency, and errors.',
  live: { pollMs: 15000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'functions', label: 'Functions', icon: FunctionSquare },
      { tile: 'metric', key: 'invocations', label: 'Invocations', icon: Activity },
      { tile: 'metric', key: 'success', label: 'Success rate', icon: Gauge, unit: 'pct' },
      { tile: 'metric', key: 'duration', label: 'Avg duration', icon: Timer, unit: 'ms' },
      { tile: 'metric', key: 'errors', label: 'Errors', icon: TriangleAlert },
    ],
    [
      { tile: 'timeseries', key: 'invocations', title: 'Invocations over time' },
      { tile: 'distribution', key: 'status', title: 'Invocation status', centerLabel: 'total' },
    ],
    [{ tile: 'health', title: 'Functions health', empty: 'Function health appears once the engine reports.' }],
  ],
  load: async ({ range }) => {
    const fns = await FunctionsApi.list()
    const stats = deriveOverview(fns)
    let metrics = null
    try {
      metrics = await FunctionsApi.metrics(fnRange(range))
    } catch {
      /* metrics route unbound → honest "not connected" on the series/donut */
    }
    return withHealth(fromFunctions(stats, metrics))
  },
}

/** The GPU/compute living overview — org compute capacity + health from the operator. */
const computeOverview: LivingOverviewConfig = {
  id: 'gpus',
  title: 'GPUs',
  subtitle: 'GPU clusters, utilization, and cost across your compute.',
  ranged: false,
  live: { pollMs: 20000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'services', label: 'Workloads', icon: Cpu },
      { tile: 'metric', key: 'clusters', label: 'Clusters', icon: Layers },
      { tile: 'metric', key: 'healthy', label: 'Healthy', icon: Gauge },
      { tile: 'metric', key: 'orgs', label: 'Orgs', icon: Users },
    ],
    [{ tile: 'health', title: 'Cluster workloads', empty: 'Workloads appear once the control plane is reachable.' }, { tile: 'alerts' }],
  ],
  load: async () => {
    const data: OverviewData = { kpi: {}, series: {}, distribution: {}, activity: [], alerts: [], health: [] }
    try {
      // The apps inventory is service-token-gated + tenant-scoped server-side, so
      // the browser sends no org filter; the platform scopes it to the caller.
      const apps = await PlatformApi.apps()
      data.health = healthFromApps(apps)
      const clusters = new Set(apps.map((a) => a.cluster).filter(Boolean))
      const orgs = new Set(apps.map((a) => a.org).filter(Boolean))
      const healthy = apps.filter((a) => String(a.health).toLowerCase() === 'green').length
      data.kpi.services = { value: apps.length }
      data.kpi.clusters = { value: clusters.size }
      data.kpi.healthy = { value: healthy }
      data.kpi.orgs = { value: orgs.size }
    } catch {
      /* honest empty — the tiles render em-dashes + "not reporting" */
    }
    return data
  },
}

/**
 * The Lux Economy / Markets living overview — the DeFiLlama-style analytics board
 * for the Lux DEX. Reads the `dex` subgraph (markets/fills/day-data) via the
 * session-gated, brand-scoped `/economy` proxy, and the maker's :2112 metrics via
 * `/trading`, and composes them with `fromLuxIndexer`. HONEST to the CLOB reality:
 * the KPIs + donuts are 24h volume / trades / book depth / active markets / best-
 * bid-ask spread (fields the subgraph really exposes); pooled USD TVL is NOT
 * fabricated (a CLOB has depth, not locked TVL), and the historical series is empty
 * until the subgraph's MarketDayData producer emits — every tile shows its honest
 * empty state, never a made-up trend. This is the analytics/management plane; the
 * markets TABLE itself lives in the MarketsModule (this board is the KPI overview).
 */
const luxEconomyOverview: LivingOverviewConfig = {
  id: 'lux-economy',
  title: 'Markets',
  subtitle: 'The Lux DEX economy — 24h volume, trades, book depth, and per-market activity across the live L*/LUX markets.',
  // A CLOB book summary + accrued 24h figures are point-in-time (not a windowed
  // series today), so no range selector until MarketDayData is produced.
  ranged: false,
  live: { pollMs: 15000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'markets', label: 'Active markets', icon: Boxes },
      { tile: 'metric', key: 'volume24h', label: '24h volume', icon: BarChart3 },
      { tile: 'metric', key: 'trades', label: '24h trades', icon: ArrowLeftRight },
      { tile: 'metric', key: 'bookDepth', label: 'Book depth', icon: Coins },
      { tile: 'metric', key: 'openOrders', label: 'Open orders', icon: Layers },
    ],
    [
      { tile: 'timeseries', key: 'volume24h', title: 'Volume over time', kind: 'bar' },
      { tile: 'distribution', key: 'volumeByMarket', title: 'Volume by market', centerLabel: 'markets' },
    ],
    [
      { tile: 'distribution', key: 'tradesByMarket', title: 'Trades by market', centerLabel: 'trades' },
      { tile: 'distribution', key: 'depthByMarket', title: 'Book depth by market', centerLabel: 'depth' },
    ],
    [
      { tile: 'activity', title: 'Recent trades', empty: 'Trades appear here as the DEX settles fills.' },
      { tile: 'health', title: 'Market maker', empty: 'Maker health appears once the maker’s metrics are reachable.' },
    ],
    [{ tile: 'alerts', title: 'Indexer status' }],
  ],
  // Read the DEX indexer for the market economy, and (best-effort) the maker metrics
  // for the maker-health row. Each source degrades independently: an unreachable
  // graph → honest empty board + an "not reporting" alert; an unreachable maker →
  // just no maker-health row. NEVER throws a fabricated figure into a tile.
  load: async () => {
    // The DEX indexer — the primary source. On failure, surface an honest not-
    // reporting snapshot (fromLuxIndexer turns it into an empty board + an alert).
    let snap: Awaited<ReturnType<typeof EconomyApi.overview>> | null = null
    try {
      snap = await EconomyApi.overview()
    } catch (e) {
      snap = { network: 'lux-testnet', status: 'not-reporting', error: e instanceof Error ? e.message : String(e), markets: [], trades: [], dayData: [] }
    }
    // The maker metrics — best-effort, for the maker-health row. The /trading proxy
    // is brand-scoped and picks the brand's network, so any valid network id works.
    let maker: Awaited<ReturnType<typeof TradingApi.makerStatus>> | null = null
    try {
      maker = await TradingApi.makerStatus('lux-testnet')
    } catch {
      /* no maker metrics → the board renders without the maker-health row */
    }
    return fromLuxIndexer(snap, maker)
  },
}

/** The declared living overviews, by product id. Add a product = add one entry. */
export const LIVING_OVERVIEWS: Record<string, LivingOverviewConfig> = {
  overview: platformOverview,
  overlord: overlordOverview,
  'admin-business': adminBusinessOverview,
  finance: financeOverview,
  'ai-metrics': aiUsageOverview('ai-metrics', 'AI Metrics', 'Requests, tokens, spend, and per-model usage for your org.'),
  'open-edition': openEditionOverview,
  functions: functionsOverview,
  gpus: computeOverview,
  'lux-economy': luxEconomyOverview,
}

/** The living-overview config for a product id, if one is declared. */
export const livingOverviewFor = (id: string): LivingOverviewConfig | undefined => LIVING_OVERVIEWS[id]

/** Product ids that have a living overview (for the registry to wire routes). */
export const livingOverviewIds = (): string[] => Object.keys(LIVING_OVERVIEWS)
