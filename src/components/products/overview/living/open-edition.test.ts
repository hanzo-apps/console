import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CloudUsageOverview, UsageOverviewParams } from '~/lib/api/usage'

/**
 * Open Edition (run-for-pay) living-overview contract.
 *
 * The generic registry consistency tests (`registry.test.ts`) already prove the
 * config is well-shaped. These pin the ONE thing that makes it a *run-for-pay*
 * board and not just another usage view: its loader reads the REAL commerce usage
 * ledger SCOPED to the `open-edition` product tag, and maps that real data through
 * `fromCloudUsage`. If the `product` scope is ever dropped (so the board silently
 * shows the whole ledger) or the loader stops reading the real API, a test fails —
 * not a customer's bill.
 *
 * The lucide ESM package isn't transformed in the node test env, so stub the icons
 * the registry uses (opaque truthy tokens — the configs carry them as `icon`
 * values the renderer, not this test, interprets).
 */
vi.mock('@hanzogui/lucide-icons-2', () => {
  const names = ['Activity', 'ArrowLeftRight', 'BarChart3', 'Coins', 'LineChart', 'Boxes', 'Building2', 'Cpu', 'CreditCard', 'DollarSign', 'FunctionSquare', 'Gauge', 'Hash', 'HeartPulse', 'Layers', 'Timer', 'TrendingUp', 'TriangleAlert', 'Users']
  return Object.fromEntries(names.map((n) => [n, `icon:${n}`]))
})

// Capture the params the loader passes to the ledger API without any network. The
// factory returns a controllable fake so we can assert BOTH the scope (product tag)
// and that real fetched data flows through to the normalized OverviewData.
const overviewMock = vi.fn<(p?: UsageOverviewParams) => Promise<CloudUsageOverview>>()
vi.mock('~/lib/api/usage', () => ({
  UsageApi: { overview: (p?: UsageOverviewParams) => overviewMock(p) },
}))

import { livingOverviewFor } from './registry'

/** A minimal but REAL-shaped ledger overview (the shape commerce → usage-adapter emits). */
function fakeOverview(over: Partial<CloudUsageOverview> = {}): CloudUsageOverview {
  return {
    range: '7d',
    start: '2026-06-25T00:00:00Z',
    end: '2026-07-02T00:00:00Z',
    interval: 'day',
    scope: { org: 'acme', allOrgs: false },
    totals: { tokens: 8000, promptTokens: 5000, completionTokens: 3000, requests: 12, spendCents: 6, models: 1, providers: 1 },
    deltas: {},
    series: [{ t: '2026-07-01T00:00:00Z', tokens: 8000, spendCents: 6, requests: 12, models: 1 }],
    byModel: { items: [{ model: 'llama-3.3-70b', provider: 'do-ai', spendCents: 6, tokens: 8000, requests: 12, pct: 100 }], other: null, totalCents: 6 },
    byStatus: [{ status: 'success', requests: 12, pct: 100 }],
    activity: { items: [], limit: 40, offset: 0, total: 0, type: 'all' },
    ...over,
  }
}

describe('Open Edition (run-for-pay) living overview', () => {
  beforeEach(() => {
    overviewMock.mockReset()
    overviewMock.mockResolvedValue(fakeOverview())
  })

  it('is registered under the open-edition id with a run-for-pay headline', () => {
    const cfg = livingOverviewFor('open-edition')
    expect(cfg).toBeDefined()
    expect(cfg!.id).toBe('open-edition')
    expect(cfg!.title).toBe('Open Edition')
    // The spend KPI is the served-revenue figure R (cost + 25%): it must be present
    // and rendered as USD cents.
    const metrics = cfg!.rows.flat().filter((t) => t.tile === 'metric')
    const spend = metrics.find((t) => t.tile === 'metric' && t.key === 'spendCents')
    expect(spend).toBeDefined()
    expect((spend as { unit?: string }).unit).toBe('cents')
  })

  it('loads REAL ledger data scoped to the open-edition product tag', async () => {
    const cfg = livingOverviewFor('open-edition')!
    const data = await cfg.load({ range: '7d' })

    // The load-bearing scope: it filters the ledger to run-for-pay workloads. Without
    // this the board would show the org's WHOLE spend, not its open-edition spend.
    expect(overviewMock).toHaveBeenCalledTimes(1)
    const passed = overviewMock.mock.calls[0][0]!
    expect(passed.product).toBe('open-edition')
    expect(passed.range).toBe('7d')

    // Real fetched data flows through fromCloudUsage into the normalized shape the
    // tiles read — the spend KPI is R, the per-model donut is the real breakdown.
    expect(data.kpi.spendCents.value).toBe(6)
    expect(data.kpi.tokens.value).toBe(8000)
    expect(data.distribution.byModel[0]).toMatchObject({ label: 'llama-3.3-70b', value: 6 })
  })

  it('forwards the global-admin allOrgs flag without widening product scope', async () => {
    const cfg = livingOverviewFor('open-edition')!
    await cfg.load({ range: '30d', allOrgs: true })
    const passed = overviewMock.mock.calls[0][0]!
    expect(passed.allOrgs).toBe(true)
    expect(passed.product).toBe('open-edition') // still scoped — allOrgs widens tenancy, not product
  })

  it('rolls up honest-empty when the org has no run-for-pay usage (no fabricated numbers)', async () => {
    // A ledger with zero open-edition rows → the adapter emits an empty per-model
    // distribution and zero totals; the tiles render em-dashes / the empty state.
    overviewMock.mockResolvedValue(
      fakeOverview({
        totals: { tokens: 0, promptTokens: 0, completionTokens: 0, requests: 0, spendCents: 0, models: 0, providers: 0 },
        series: [],
        byModel: { items: [], other: null, totalCents: 0 },
        byStatus: [],
        activity: { items: [], limit: 40, offset: 0, total: 0, type: 'all' },
      }),
    )
    const cfg = livingOverviewFor('open-edition')!
    const data = await cfg.load({ range: '24h' })
    expect(data.kpi.spendCents.value).toBe(0)
    expect(data.distribution.byModel).toEqual([])
    expect(data.activity).toEqual([])
  })
})
