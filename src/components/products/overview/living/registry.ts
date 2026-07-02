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
import { Activity, Building2, Cpu, CreditCard, DollarSign, FunctionSquare, Gauge, Hash, Layers, Timer, TrendingUp, TriangleAlert, Users } from '@hanzogui/lucide-icons-2'

import { UsageApi } from '~/lib/api/usage'
import { AdminApi } from '~/lib/api/admin-overview'
import { FinanceApi } from '~/lib/api/finance'
import { PlatformApi } from '~/lib/api/platform'
import { FunctionsApi, deriveOverview } from '~/lib/api/functions'
import type { LivingOverviewConfig, OverviewData, OverviewRange } from './config'
import { fromAdminOverview, fromCloudUsage, fromFinance, fromFunctions, healthFromApps } from './adapters'

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
  // The apps inventory (`/paas/apps`) is admin-gated on this deployment, so a
  // tenant user's probe only 403s — skip it and leave health in its honest empty
  // state instead of firing a request we know will be rejected (keeps the browser
  // console clean). Global admins (probeApps=true, the default) still enrich health.
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
  load: async ({ range, allOrgs, isGlobalAdmin }) => {
    // `/v1/admin/overview` is a cross-tenant aggregate, server-gated to global
    // admins. A tenant user (even an org's OWN admin, e.g. `hanzo/z`) only ever
    // gets a 403 from it, so don't fire it for them — go straight to the org-scoped
    // usage ledger (the same source the catch-fallback already used). This keeps a
    // tenant admin's overview working AND silent, instead of spamming the browser
    // console with 403s for a call that can't succeed.
    if (isGlobalAdmin) {
      try {
        const ov = await AdminApi.overview({ range, allOrgs, activityLimit: 40 })
        const data = fromAdminOverview(ov)
        // The admin aggregate carries health; only probe the operator if it didn't.
        return data.health.length ? data : withHealth(data)
      } catch {
        /* Admin backend not routed on this host → fall through to the usage ledger. */
      }
    }
    // Tenant user, or the admin aggregate was unavailable: the real usage ledger.
    const usage = await UsageApi.overview({
      range: usageRange(range),
      activityType: 'all',
      activityLimit: 40,
      topModels: 6,
      allOrgs,
    })
    const data = fromCloudUsage(usage)
    // Reuse the byModel breakdown as the "revenue"/spend donut on the fallback path.
    data.distribution.revenue = data.distribution.byModel ?? []
    // Skip the admin-gated apps probe for tenant users (→ honest empty health)
    // so it doesn't 403; global admins whose aggregate just failed still probe.
    return withHealth(data, isGlobalAdmin)
  },
}

/**
 * The admin.hanzo.ai BUSINESS overview — the SaaS control board for running the
 * business: MRR/revenue, total usage & cost trend, active orgs/customers, top
 * agents/bots by cost, subscription/plan mix, and fleet health. GLOBAL-ADMIN ONLY
 * (gated by the registry `admin` flag + `useIsGlobalAdmin`; the `/v1/admin/overview`
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
  subtitle: 'DigitalOcean credit burn-down, spend, revenue, gross margin, and runway across the platform.',
  ranged: false, // the finance aggregate is a point-in-time snapshot, not a windowed series
  live: { pollMs: 60000, countUp: true },
  rows: [
    [
      { tile: 'metric', key: 'creditRemaining', label: 'DO credit remaining', icon: CreditCard, unit: 'cents' },
      { tile: 'metric', key: 'spendCents', label: 'Month-to-date spend', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'mrr', label: 'MRR', icon: TrendingUp, unit: 'cents' },
      { tile: 'metric', key: 'revenue', label: 'Total revenue', icon: DollarSign, unit: 'cents' },
      { tile: 'metric', key: 'marginPct', label: 'Gross margin', icon: Gauge, unit: 'pct' },
      { tile: 'metric', key: 'runwayDays', label: 'Runway (days)', icon: Timer },
    ],
    [{ tile: 'timeseries', key: 'spendCents', title: 'DigitalOcean credit burn-down', kind: 'bar', unit: 'cents' }],
    [{ tile: 'health', title: 'Profitability', empty: 'Connect DO_API_TOKEN to compute margin.' }, { tile: 'alerts', title: 'Finance alerts' }],
  ],
  // No try/catch fallback: finance is TRUE-by-construction. A denied (403)/not-routed
  // (404) backend throws a typed ApiError the ONE LivingOverview renders as an honest
  // error state — we never substitute a fabricated revenue/margin.
  load: async () => fromFinance(await FinanceApi.finance()),
}

/** The AI-usage living overview for a product scoped to the org's model spend. */
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
      await UsageApi.overview({ range: usageRange(range), activityType: 'all', activityLimit: 40, topModels: 6, allOrgs }),
    ),
})

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
    [{ tile: 'health', title: 'Fission health', empty: 'Function health appears once the engine reports.' }],
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

/** The declared living overviews, by product id. Add a product = add one entry. */
export const LIVING_OVERVIEWS: Record<string, LivingOverviewConfig> = {
  overview: platformOverview,
  'admin-business': adminBusinessOverview,
  finance: financeOverview,
  'ai-metrics': aiUsageOverview('ai-metrics', 'AI Metrics', 'Requests, tokens, spend, and per-model usage for your org.'),
  functions: functionsOverview,
  gpus: computeOverview,
}

/** The living-overview config for a product id, if one is declared. */
export const livingOverviewFor = (id: string): LivingOverviewConfig | undefined => LIVING_OVERVIEWS[id]

/** Product ids that have a living overview (for the registry to wire routes). */
export const livingOverviewIds = (): string[] => Object.keys(LIVING_OVERVIEWS)
