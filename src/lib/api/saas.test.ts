import { describe, it, expect } from 'vitest'

import { normalizeSaaS } from './saas'

describe('normalizeSaaS — /v1/metrics/saas → SaaSMetrics', () => {
  it('maps a full real payload field-for-field', () => {
    const raw = {
      asOf: '2026-07-08T21:00:00Z',
      currency: 'usd',
      window: '30d',
      revenue: {
        mrrCents: 1_234_500,
        arrCents: 14_814_000,
        activeSubscriptions: 340,
        payingCustomers: 300,
        trials: 45,
        newMrrCents: 82_000,
        churnedMrrCents: 21_000,
        netNewMrrCents: 61_000,
        byCategory: [
          { category: 'world', mrrCents: 500_000, subscriptions: 120 },
          { category: 'personal', mrrCents: 400_000, subscriptions: 90 },
        ],
      },
      subscriptions: {
        byPlan: [{ plan: 'world-pro', name: 'World Pro', category: 'world', active: 80, trialing: 12, seats: 80, mrrCents: 160_000 }],
        trialsActive: 45,
        new: 22,
        canceled: 9,
        upgrades: null,
        downgrades: null,
        recent: [{ at: '2026-07-08T12:00:00Z', org: 'acme', type: 'created', plan: 'world-pro', category: 'world', mrrDeltaCents: 2000 }],
      },
      usage: { instrumented: true, windowUsageCents: 875_000, requests: 41_234, untaggedRequests: 12 },
      customers: [{ org: 'acme', plan: 'world-team', category: 'world', status: 'active', mrrCents: 30_000, usageCents: 220_000, seats: 5, since: '2026-01-05T00:00:00Z' }],
      orgs: 512,
      gaps: ['subscriptions.upgrades / downgrades: not instrumented', ''],
    }
    const s = normalizeSaaS(raw)
    expect(s.revenue.mrrCents).toBe(1_234_500)
    expect(s.revenue.arrCents).toBe(14_814_000)
    expect(s.revenue.netNewMrrCents).toBe(61_000)
    expect(s.revenue.byCategory).toHaveLength(2)
    expect(s.revenue.byCategory[0]).toEqual({ category: 'world', mrrCents: 500_000, subscriptions: 120 })
    expect(s.subscriptions.byPlan[0].name).toBe('World Pro')
    expect(s.subscriptions.recent[0].mrrDeltaCents).toBe(2000)
    expect(s.usage.instrumented).toBe(true)
    expect(s.usage.windowUsageCents).toBe(875_000)
    expect(s.customers[0]).toEqual({ org: 'acme', plan: 'world-team', category: 'world', status: 'active', mrrCents: 30_000, usageCents: 220_000, seats: 5, since: '2026-01-05T00:00:00Z' })
    expect(s.orgs).toBe(512)
    // Empty gap strings are dropped; real notes kept.
    expect(s.gaps).toEqual(['subscriptions.upgrades / downgrades: not instrumented'])
  })

  it('PRESERVES null upgrades/downgrades (a not-instrumented signal, never 0)', () => {
    const s = normalizeSaaS({ subscriptions: { upgrades: null, downgrades: null } })
    expect(s.subscriptions.upgrades).toBeNull()
    expect(s.subscriptions.downgrades).toBeNull()
  })

  it('reads a numeric upgrades count when the backend does instrument it', () => {
    const s = normalizeSaaS({ subscriptions: { upgrades: 7, downgrades: 3 } })
    expect(s.subscriptions.upgrades).toBe(7)
    expect(s.subscriptions.downgrades).toBe(3)
  })

  it('degrades an empty / garbage payload to honest zeros + empty lists (never throws, never fabricates)', () => {
    for (const bad of [null, undefined, {}, 42, 'nope', []]) {
      const s = normalizeSaaS(bad)
      expect(s.revenue.mrrCents).toBe(0)
      expect(s.revenue.byCategory).toEqual([])
      expect(s.subscriptions.byPlan).toEqual([])
      expect(s.subscriptions.recent).toEqual([])
      expect(s.customers).toEqual([])
      expect(s.usage.instrumented).toBe(false)
      expect(s.orgs).toBe(0)
      expect(s.currency).toBe('usd')
      expect(s.window).toBe('30d')
    }
  })

  it('tolerates snake_case keys from an alternate backend encoding', () => {
    const s = normalizeSaaS({
      as_of: '2026-07-08T00:00:00Z',
      revenue: { mrr_cents: 5000, arr_cents: 60_000, active_subscriptions: 3, paying_customers: 2, new_mrr_cents: 1000, churned_mrr_cents: 400, net_new_mrr_cents: 600, by_category: [{ category: 'ai', mrr_cents: 5000, subscriptions: 3 }] },
      usage: { instrumented: true, window_usage_cents: 900, untagged_requests: 1 },
      customers: [{ org: 'beta', mrr_cents: 5000, usage_cents: 900 }],
    })
    expect(s.asOf).toBe('2026-07-08T00:00:00Z')
    expect(s.revenue.mrrCents).toBe(5000)
    expect(s.revenue.activeSubscriptions).toBe(3)
    expect(s.revenue.byCategory[0]).toEqual({ category: 'ai', mrrCents: 5000, subscriptions: 3 })
    expect(s.usage.windowUsageCents).toBe(900)
    expect(s.customers[0].mrrCents).toBe(5000)
    expect(s.customers[0].usageCents).toBe(900)
  })
})
