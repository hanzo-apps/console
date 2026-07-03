import { describe, it, expect } from 'vitest'

import type { CloudUsageOverview } from '~/lib/api/usage'
import type { AdminOverview } from '~/lib/api/admin-overview'
import type { Finance } from '~/lib/api/finance'
import type { PlatformApp } from '~/lib/api/platform'
import type { FunctionsMetrics, OverviewStats } from '~/lib/api/functions'
import { fromCloudUsage, fromAdminOverview, fromFinance, financeHealth, fromFunctions, healthFromApps, healthTally, orgsFromApps, fromOverlord, sumSeriesLines } from './adapters'

/**
 * The adapters are the pure maps from each REAL source onto `OverviewData`. These
 * pin that (a) every real field lands on the right tile key, (b) nothing is
 * fabricated (a source with no data → empty maps → honest empty tiles), and (c) the
 * SHAPES match the real `/v1` responses — so a unit test that mocks the HTTP layer
 * exercises the same normalized data the tiles render in production.
 */

// A minimal-but-real CloudUsageOverview (the shape usage-adapter.ts produces).
const usage = (): CloudUsageOverview => ({
  range: '24h',
  start: '',
  end: '',
  interval: 'hour',
  scope: { org: 'acme', allOrgs: false },
  totals: { tokens: 1500, promptTokens: 900, completionTokens: 600, requests: 12, spendCents: 340, models: 3, providers: 2 },
  deltas: {
    tokens: { current: 1500, prior: 1000, pct: 50 },
    spendCents: { current: 340, prior: 300, pct: 13 },
    requests: { current: 12, prior: 10, pct: 20 },
    models: { current: 3, prior: 3, pct: 0 },
  },
  series: [
    { t: '2026-06-30T10:00:00Z', tokens: 500, spendCents: 100, requests: 4, models: 2 },
    { t: '2026-06-30T11:00:00Z', tokens: 1000, spendCents: 240, requests: 8, models: 3 },
  ],
  byModel: {
    items: [
      { model: 'zen5', provider: 'do-ai', spendCents: 240, tokens: 1000, requests: 8, pct: 70 },
      { model: 'gpt-4o', provider: 'openai', spendCents: 100, tokens: 500, requests: 4, pct: 30 },
    ],
    other: null,
    totalCents: 340,
  },
  byStatus: [
    { status: 'success', requests: 11, pct: 92 },
    { status: 'error', requests: 1, pct: 8 },
  ],
  activity: {
    items: [
      { time: '2026-06-30T11:00:00Z', model: 'zen5', provider: 'do-ai', type: 'inference', status: 'success', tokens: 1000, promptTokens: 600, completionTokens: 400, costCents: 240, stream: true, premium: false, requestId: 'rq1', org: 'acme', user: 'u' },
    ],
    limit: 40,
    offset: 0,
    total: 1,
    type: 'all',
  },
})

describe('fromCloudUsage — commerce ledger → OverviewData', () => {
  it('maps totals/deltas/series onto the KPI + series keys', () => {
    const d = fromCloudUsage(usage())
    expect(d.kpi.tokens).toEqual({ value: 1500, prior: 1000, series: [500, 1000] })
    expect(d.kpi.spendCents.prior).toBe(300)
    expect(d.series.tokens.interval).toBe('hour')
    expect(d.series.tokens.points).toEqual([
      { t: '2026-06-30T10:00:00Z', value: 500 },
      { t: '2026-06-30T11:00:00Z', value: 1000 },
    ])
  })
  it('maps the model breakdown to the distribution and inference to activity', () => {
    const d = fromCloudUsage(usage())
    expect(d.distribution.byModel[0]).toEqual({ label: 'zen5', value: 240, sub: 'do-ai' })
    expect(d.activity).toHaveLength(1)
    expect(d.activity[0]).toMatchObject({ id: 'rq1', title: 'Inference · zen5', status: 'success' })
    expect(d.activityTotal).toBe(1)
  })
  it('maps the Metrics-dashboard breakdowns: top models by tokens + requests by status', () => {
    const d = fromCloudUsage(usage())
    // tokens donut = the SAME per-model rollup valued on tokens (not spend)
    expect(d.distribution.byModelTokens[0]).toEqual({ label: 'zen5', value: 1000, sub: 'do-ai' })
    // status donut = real requests-by-status, title-cased for the legend
    expect(d.distribution.byStatus).toEqual([
      { label: 'Success', value: 11 },
      { label: 'Error', value: 1 },
    ])
  })
  it('is honest-empty for an org with no usage', () => {
    const zero = usage()
    zero.totals = { tokens: 0, promptTokens: 0, completionTokens: 0, requests: 0, spendCents: 0, models: 0, providers: 0 }
    zero.series = []
    zero.byModel = { items: [], other: null, totalCents: 0 }
    zero.byStatus = []
    zero.activity = { items: [], limit: 40, offset: 0, total: 0, type: 'all' }
    const d = fromCloudUsage(zero)
    expect(d.kpi.tokens.value).toBe(0)
    expect(d.distribution.byModel).toEqual([])
    expect(d.distribution.byModelTokens).toEqual([])
    expect(d.distribution.byStatus).toEqual([])
    expect(d.activity).toEqual([])
  })
})

describe('fromAdminOverview — /v1/admin aggregate → OverviewData', () => {
  const admin = (): AdminOverview => ({
    range: '7d',
    kpis: [
      { key: 'orgs', value: 5, prior: 4 },
      { key: 'spendCents', value: 9000, unit: 'cents', series: [1, 2, 3] },
    ],
    series: [{ key: 'spendCents', interval: 'day', points: [{ t: '2026-06-30T00:00:00Z', value: 9000 }] }],
    distribution: [{ label: 'Inference', value: 6000, hint: 'ai' }],
    activity: [{ id: 'e1', time: 't', kind: 'signin', title: 'Login', status: 'success', org: 'acme' }],
    alerts: [{ id: 'a1', severity: 'critical', title: 'DB peer lost' }],
    health: [{ service: 'gateway', health: 'green', cluster: 'nyc1', detail: 'reconciled' }],
  })
  it('lands kpis/series/distribution/activity/alerts/health', () => {
    const d = fromAdminOverview(admin())
    expect(d.kpi.orgs).toEqual({ value: 5, prior: 4 })
    expect(d.kpi.spendCents.series).toEqual([1, 2, 3])
    expect(d.series.spendCents.points[0].value).toBe(9000)
    expect(d.distribution.revenue[0]).toEqual({ label: 'Inference', value: 6000, sub: 'ai' })
    expect(d.activity[0].title).toBe('Login')
    expect(d.alerts[0].severity).toBe('critical')
    // The admin row carries its own `detail`; `cluster` is not a health-row field.
    expect(d.health[0]).toEqual({ service: 'gateway', health: 'green', detail: 'reconciled' })
  })

  it('projects named business distributions (plans, topAgents) into distribution[key]', () => {
    const d = fromAdminOverview({
      ...admin(),
      distributions: {
        revenue: [{ label: 'Chat', value: 3000 }], // named revenue overrides the flat one
        plans: [{ label: 'Pro', value: 12, hint: 'seats' }],
        topAgents: [{ label: 'hanzo-support-bot', value: 900 }],
      },
    })
    expect(d.distribution.revenue[0]).toEqual({ label: 'Chat', value: 3000, sub: undefined })
    expect(d.distribution.plans).toEqual([{ label: 'Pro', value: 12, sub: 'seats' }])
    expect(d.distribution.topAgents[0]).toEqual({ label: 'hanzo-support-bot', value: 900, sub: undefined })
  })

  it('leaves business distributions absent when the aggregate omits them (honest empty)', () => {
    const d = fromAdminOverview(admin())
    expect(d.distribution.plans).toBeUndefined()
    expect(d.distribution.topAgents).toBeUndefined()
  })
})

describe('sumSeriesLines / fromFunctions — Functions inventory + metrics', () => {
  const stats: OverviewStats = { count: 4, invocations7d: 1200, successRate: 0.98, avgDurationMs: 340, errors7d: 24 }
  const metrics = (): FunctionsMetrics => ({
    series: [
      { key: 'fn-a', points: [{ t: '2026-06-30T10:00:00Z', v: 100 }, { t: '2026-06-30T11:00:00Z', v: 200 }] },
      { key: 'fn-b', points: [{ t: '2026-06-30T10:00:00Z', v: 50 }, { t: '2026-06-30T11:00:00Z', v: 80 }] },
    ],
    status: { success: 1176, timeout: 12, error: 12 },
    costCents: null,
  })
  it('sums per-function lines by timestamp, ordered', () => {
    expect(sumSeriesLines(metrics().series)).toEqual([
      { t: '2026-06-30T10:00:00Z', value: 150 },
      { t: '2026-06-30T11:00:00Z', value: 280 },
    ])
  })
  it('maps stats → KPIs and metrics → series + status donut', () => {
    const d = fromFunctions(stats, metrics())
    expect(d.kpi.functions.value).toBe(4)
    expect(d.kpi.invocations.value).toBe(1200)
    expect(d.kpi.invocations.series).toEqual([150, 280])
    expect(d.kpi.success.value).toBe(98) // 0.98 → 98%
    expect(d.kpi.duration.value).toBe(340)
    expect(d.series.invocations.points).toHaveLength(2)
    expect(d.distribution.status).toEqual([
      { label: 'Success', value: 1176 },
      { label: 'Timeout', value: 12 },
      { label: 'Error', value: 12 },
    ])
  })
  it('honest-empty series/donut when metrics are unbound (null)', () => {
    const d = fromFunctions({ count: 2, invocations7d: null, successRate: null, avgDurationMs: null, errors7d: null }, null)
    expect(d.kpi.functions.value).toBe(2)
    expect(d.kpi.invocations).toBeUndefined() // no invocation data → no tile value
    expect(d.series.invocations).toBeUndefined()
    expect(d.distribution.status).toBeUndefined()
  })
})

describe('healthFromApps — operator inventory → health rows', () => {
  const app = (over: Partial<PlatformApp>): PlatformApp => ({ id: over.app ?? 'x', org: 'acme', app: over.app ?? 'x', env: 'main', health: over.health ?? 'green', cluster: over.cluster ?? 'nyc1', ...over })
  it('dedupes to one row per app and keeps the real verdict, sorted', () => {
    const rows = healthFromApps([app({ app: 'gateway', health: 'green' }), app({ app: 'iam', health: 'red' }), app({ app: 'gateway', health: 'yellow' })])
    expect(rows.map((r) => r.service)).toEqual(['gateway', 'iam'])
    expect(rows.find((r) => r.service === 'gateway')?.health).toBe('yellow') // last observation wins
  })
  it('empty inventory → no rows (honest "not reporting")', () => {
    expect(healthFromApps([])).toEqual([])
  })
})

describe('healthTally / orgsFromApps / fromOverlord — the Overlord god-view', () => {
  const app = (over: Partial<PlatformApp>): PlatformApp => ({ id: over.app ?? 'x', org: over.org ?? 'acme', app: over.app ?? 'x', env: 'main', health: over.health ?? 'green', cluster: over.cluster ?? 'nyc1', ...over })

  it('healthTally counts by verdict; unknown catches "" and unexpected strings', () => {
    const t = healthTally([
      { service: 'a', health: 'green' },
      { service: 'b', health: 'green' },
      { service: 'c', health: 'yellow' },
      { service: 'd', health: 'red' },
      { service: 'e', health: '' },
      { service: 'f', health: 'weird' },
    ])
    expect(t).toEqual({ total: 6, healthy: 2, degraded: 1, down: 1, unknown: 2 })
  })

  it('healthTally of empty → all zeros (honest em-dash, never a fabricated all-healthy)', () => {
    expect(healthTally([])).toEqual({ total: 0, healthy: 0, degraded: 0, down: 0, unknown: 0 })
  })

  it('orgsFromApps returns distinct non-empty orgs, sorted', () => {
    expect(orgsFromApps([app({ org: 'zoo' }), app({ org: 'acme' }), app({ org: 'zoo' }), app({ org: '' })])).toEqual(['acme', 'zoo'])
  })

  it('fromOverlord builds the product board + counts from the operator inventory (no aggregate, no ledger)', () => {
    const apps = [
      app({ app: 'gateway', org: 'hanzo', health: 'green' }),
      app({ app: 'iam', org: 'hanzo', health: 'green' }),
      app({ app: 'commerce', org: 'acme', health: 'yellow' }),
      app({ app: 'ml', org: 'acme', health: 'red' }),
    ]
    const d = fromOverlord(apps, null, null)
    // Product-count KPIs derived from the real health tally.
    expect(d.kpi.products?.value).toBe(4)
    expect(d.kpi.healthy?.value).toBe(2)
    expect(d.kpi.attention?.value).toBe(2) // degraded (1) + down (1)
    // Active orgs from the distinct inventory orgs.
    expect(d.kpi.orgs?.value).toBe(2)
    // Full product-health board present.
    expect(d.health.map((h) => h.service).sort()).toEqual(['commerce', 'gateway', 'iam', 'ml'])
    // Health-mix donut, positive slices only (no "Unknown" here).
    expect(d.distribution.productHealth).toEqual([
      { label: 'Healthy', value: 2 },
      { label: 'Degraded', value: 1 },
      { label: 'Down', value: 1 },
    ])
    // No aggregate + no ledger → the usage KPIs are honestly absent (em-dash), not 0.
    expect(d.kpi.spendCents).toBeUndefined()
    expect(d.kpi.requests).toBeUndefined()
  })

  it('fromOverlord layers the admin aggregate usage/spend on top, keeping the real product board', () => {
    const ov: AdminOverview = {
      range: '24h',
      kpis: [{ key: 'spendCents', value: 5000, unit: 'cents' }, { key: 'requests', value: 42 }, { key: 'orgs', value: 9 }],
      series: [{ key: 'requests', interval: 'hour', points: [{ t: 't1', value: 10 }, { t: 't2', value: 32 }] }],
      distribution: [{ label: 'Inference', value: 5000 }],
      activity: [{ id: 'e1', time: 't', kind: 'inference', title: 'call', status: 'success' }],
      alerts: [],
      health: [{ service: 'stale', health: 'green' }],
    }
    const apps = [app({ app: 'gateway', org: 'hanzo', health: 'green' }), app({ app: 'ml', org: 'acme', health: 'red' })]
    const d = fromOverlord(apps, ov, null)
    // Usage/spend from the aggregate.
    expect(d.kpi.spendCents?.value).toBe(5000)
    expect(d.kpi.requests?.value).toBe(42)
    // The aggregate's own org count wins over the inventory-derived count.
    expect(d.kpi.orgs?.value).toBe(9)
    // The operator inventory's FULL board overrides the aggregate's summary health.
    expect(d.health.map((h) => h.service).sort()).toEqual(['gateway', 'ml'])
    // Product-count KPIs still derived from the real inventory (2 products, 1 down).
    expect(d.kpi.products?.value).toBe(2)
    expect(d.kpi.attention?.value).toBe(1)
    // Spend-by-product donut carried from the aggregate distribution.
    expect(d.distribution.revenue).toEqual([{ label: 'Inference', value: 5000, sub: undefined }])
  })

  it('fromOverlord with no inventory but a ledger → usage real, product board honest-empty', () => {
    const d = fromOverlord([], null, usage())
    // Usage KPIs from the ledger fallback.
    expect(d.kpi.spendCents?.value).toBe(340)
    // No inventory → no product-count KPIs (honest em-dash) + empty health board.
    expect(d.kpi.products).toBeUndefined()
    expect(d.health).toEqual([])
    expect(d.distribution.productHealth).toBeUndefined()
  })
})

// A minimal-but-real Finance payload (the shape normalizeFinance produces).
const finance = (
  over: Partial<Finance['cost']['digitalocean']> = {},
  rev: Partial<Finance['revenue']> = {},
  der: Partial<Finance['derived']> = {},
  costOver: Partial<Omit<Finance['cost'], 'digitalocean'>> = {},
): Finance => ({
  cost: {
    configured: true,
    error: '',
    period: '2026-07',
    totalCents: 350_000, // $3,500 COGS: DO compute $3,000 + OpenAI $500
    vendors: [
      { vendor: 'digitalocean', service: 'compute', amountCents: 300_000, source: 'actual', note: '' },
      { vendor: 'openai', service: 'llm-inference', amountCents: 50_000, source: 'actual', note: '' },
    ],
    digitalocean: {
      configured: true,
      error: '',
      creditRemainingCents: 1_000_000, // $10,000 credit remaining
      monthToDateSpendCents: 300_000, // $3,000 MTD spend
      avgDailyBurnCents: 30_000,
      accountBalanceCents: -1_000_000,
      generatedAt: '2026-07-15T00:00:00Z',
      history: [
        { date: '2026-06-01T00:00:00Z', amountCents: 280_000, type: 'Invoice', description: 'June' },
        { date: '2026-05-01T00:00:00Z', amountCents: -4_000_000, type: 'Credit', description: 'Promo credit' },
        { date: '2026-04-01T00:00:00Z', amountCents: 150_000, type: 'Invoice', description: 'April' },
      ],
      ...over,
    },
    ...costOver,
  },
  revenue: { configured: true, totalRevenueCents: 3_500_000, mrrCents: 500_000, creditsConsumedCents: 3_500_000, ...rev },
  derived: { grossMarginCents: 3_200_000, grossMarginPct: 91, runwayDays: 33.3, profitable: true, ...der },
  generatedAt: '2026-07-15T00:00:00Z',
})

describe('fromFinance — /v1/admin/finance → OverviewData', () => {
  it('maps COGS (all vendors), DO credit, revenue, MRR, margin, and runway onto their KPI keys', () => {
    const d = fromFinance(finance())
    expect(d.kpi.spendCents.value).toBe(350_000) // COGS total (commerce), not DO MTD
    expect(d.kpi.creditRemaining.value).toBe(1_000_000)
    expect(d.kpi.mrr.value).toBe(500_000)
    expect(d.kpi.revenue.value).toBe(3_500_000)
    expect(d.kpi.marginPct.value).toBe(91)
    expect(d.kpi.runwayDays.value).toBe(33.3)
  })

  it('projects per-vendor COGS onto the vendorCogs distribution (positive lines only)', () => {
    const d = fromFinance(finance())
    expect(d.distribution.vendorCogs).toEqual([
      { label: 'digitalocean', value: 300_000, sub: 'compute' },
      { label: 'openai', value: 50_000, sub: 'llm-inference' },
    ])
  })

  it('drops zero/pending vendor lines from the donut (no padding)', () => {
    const d = fromFinance(finance({}, {}, {}, {
      vendors: [
        { vendor: 'digitalocean', service: 'compute', amountCents: 300_000, source: 'actual', note: '' },
        { vendor: 'cloudflare', service: 'cdn-dns', amountCents: 0, source: 'estimated', note: 'not wired' },
      ],
    }))
    expect(d.distribution.vendorCogs).toEqual([{ label: 'digitalocean', value: 300_000, sub: 'compute' }])
  })

  it('builds the burn-down series from positive charges only, oldest→newest', () => {
    const d = fromFinance(finance())
    // The -$40,000 Credit grant is excluded; the two Invoice charges are sorted by date.
    expect(d.series.spendCents.points).toEqual([
      { t: '2026-04-01T00:00:00Z', value: 150_000 },
      { t: '2026-06-01T00:00:00Z', value: 280_000 },
    ])
  })

  it('renders a single profitability health verdict', () => {
    const d = fromFinance(finance())
    expect(d.health).toHaveLength(1)
    expect(d.health[0]).toMatchObject({ service: 'Profitability', health: 'green' })
  })

  it('DO treasury unconfigured → no credit/burn-down, but COGS + margin still flow from commerce', () => {
    const d = fromFinance(finance({ configured: false, creditRemainingCents: 0, monthToDateSpendCents: 0, history: [] }))
    // DO-only tiles blank out honestly.
    expect(d.kpi.creditRemaining).toBeUndefined()
    expect(d.series.spendCents).toBeUndefined() // no DO charges → no fabricated burn-down
    // COGS + margin are commerce's, decoupled from DO — a missing DO_API_TOKEN never blanks them.
    expect(d.kpi.spendCents.value).toBe(350_000)
    expect(d.kpi.marginPct.value).toBe(91)
    expect(d.distribution.vendorCogs).toHaveLength(2)
    expect(d.kpi.revenue.value).toBe(3_500_000)
    expect(d.health[0].health).toBe('green') // COGS configured + profitable → real verdict
  })

  it('is honest-empty when commerce COGS is unconfigured — no fabricated spend/margin/donut', () => {
    const d = fromFinance(finance({}, {}, {}, { configured: false, totalCents: 0, vendors: [] }))
    expect(d.kpi.spendCents).toBeUndefined()
    expect(d.kpi.marginPct).toBeUndefined()
    expect(d.distribution.vendorCogs).toBeUndefined()
    // DO treasury still surfaces (independent of commerce COGS).
    expect(d.kpi.creditRemaining.value).toBe(1_000_000)
    expect(d.health[0].health).toBe('') // COGS off → unknown verdict, never a fabricated green
  })

  it('omits the runway KPI when runway is null (no fabricated 0 days)', () => {
    const d = fromFinance(finance({}, {}, { runwayDays: null }))
    expect(d.kpi.runwayDays).toBeUndefined()
  })
})

describe('financeHealth — profitability verdict (pure)', () => {
  it('green when profitable with a healthy margin', () => {
    expect(financeHealth(finance({}, {}, { profitable: true, grossMarginPct: 91 })).health).toBe('green')
  })
  it('yellow when profitable but thin (< 20%)', () => {
    expect(financeHealth(finance({}, {}, { profitable: true, grossMarginPct: 12 })).health).toBe('yellow')
  })
  it('red when burning faster than earning', () => {
    expect(financeHealth(finance({}, {}, { profitable: false, grossMarginPct: -50 })).health).toBe('red')
  })
  it('unknown ("") when commerce COGS is unconfigured — never a fabricated green', () => {
    expect(financeHealth(finance({}, {}, {}, { configured: false })).health).toBe('')
  })
})
