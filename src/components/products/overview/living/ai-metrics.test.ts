import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CloudUsageOverview } from '~/lib/api/usage'

/**
 * AI Metrics living-overview contract — WHICH SOURCE the board reads.
 *
 * `/metrics` renders this config for every non-superadmin, and its "Tokens" tile read
 * 0 while the window held millions. Not a rollup bug: it loaded the commerce usage
 * ledger (`/v1/billing/usage`), whose records are `{amount, createdAt, decimal,
 * metadata, transactionId}` — a charge, with no token count anywhere in it. A tile
 * summing an absent field can only ever be 0, and no amount of care downstream can
 * recover a number the source never sent.
 *
 * So the thing worth pinning is the SOURCE. These assert the loader calls the
 * warehouse aggregate that measures tokens, and that a real token count survives the
 * mapping. If someone repoints it back at the ledger, this fails — not a customer
 * reading "0" next to a page that says 10.8M.
 *
 * The lucide ESM package isn't transformed in the node test env, so stub the icons.
 */
vi.mock('@hanzogui/lucide-icons-2', () => {
  const names = ['Activity', 'ArrowLeftRight', 'BarChart3', 'Coins', 'LineChart', 'Boxes', 'Building2', 'Cpu', 'CreditCard', 'DollarSign', 'FunctionSquare', 'Gauge', 'Hash', 'HeartPulse', 'Layers', 'Timer', 'TrendingUp', 'TriangleAlert', 'Users']
  return Object.fromEntries(names.map((n) => [n, `icon:${n}`]))
})

/** The warehouse aggregate — the source that measures tokens. */
const cloudMock = vi.fn()
vi.mock('~/lib/api/cloud-usage', () => ({
  CloudUsageApi: { overview: (range: string, p?: unknown) => cloudMock(range, p) },
}))

/** The commerce ledger — the source that does NOT. Must not be reached from here. */
const ledgerMock = vi.fn()
vi.mock('~/lib/api/usage', () => ({
  UsageApi: { overview: (p?: unknown) => ledgerMock(p) },
}))

import { livingOverviewFor } from './registry'

/** The config under test — absent means the id was renamed, which is itself a failure. */
function aiMetrics() {
  const cfg = livingOverviewFor('ai-metrics')
  if (!cfg) throw new Error('no living overview registered for ai-metrics')
  return cfg
}

/** A real-shaped warehouse overview carrying an actual token count. */
function fakeOverview(over: Partial<CloudUsageOverview> = {}): CloudUsageOverview {
  return {
    range: '7d',
    start: '2026-08-07T00:00:00Z',
    end: '2026-08-14T00:00:00Z',
    interval: 'day',
    scope: { org: 'hanzo', allOrgs: false },
    totals: { tokens: 10_811_144, promptTokens: 10_400_000, completionTokens: 411_144, requests: 1255, spendCents: 3354, models: 19, providers: 4 },
    deltas: {},
    series: [{ t: '2026-08-13T00:00:00Z', tokens: 10_811_144, spendCents: 3354, requests: 1255, models: 19 }],
    byModel: { items: [{ model: 'enso-flash', provider: 'enso', spendCents: 940, tokens: 5_000_000, requests: 400, pct: 28 }], other: null, totalCents: 3354 },
    activity: { items: [], limit: 40, offset: 0, total: 0, type: 'all' },
    ...over,
  } as CloudUsageOverview
}

describe('AI Metrics living overview — reads the source that measures tokens', () => {
  beforeEach(() => {
    cloudMock.mockReset()
    ledgerMock.mockReset()
    cloudMock.mockResolvedValue(fakeOverview())
  })

  it('loads from the warehouse aggregate, never the commerce ledger', async () => {
    await aiMetrics().load({ range: '7d' })
    expect(cloudMock).toHaveBeenCalledTimes(1)
    expect(ledgerMock).not.toHaveBeenCalled()
  })

  it('forwards the selected range so the board is windowed server-side', async () => {
    await aiMetrics().load({ range: '30d' })
    expect(cloudMock.mock.calls[0][0]).toBe('30d')
  })

  // THE DEFECT, stated as a number: the tile said 0 for a window holding millions.
  it('carries a real token count onto the Tokens tile', async () => {
    const d = await aiMetrics().load({ range: '7d' })
    expect(d.kpi.tokens?.value).toBe(10_811_144)
    expect(d.kpi.requests?.value).toBe(1255)
    expect(d.kpi.spendCents?.value).toBe(3354)
  })

  it('keeps the superadmin all-orgs view scoped through the same call', async () => {
    await aiMetrics().load({ range: '7d', allOrgs: true })
    expect(cloudMock.mock.calls[0][1]).toMatchObject({ org: 'all' })
  })

  it('still declares the Tokens tile it is now able to answer', () => {
    const tiles = aiMetrics().rows.flat()
    expect(tiles.some((t) => t.tile === 'metric' && t.key === 'tokens')).toBe(true)
  })
})
