import { describe, it, expect } from 'vitest'
import { normalizeOverview, normalizeSeries, normalizeTop } from './analytics'

describe('analytics normalizers — bind to the REAL clients/analytics response structs', () => {
  it('normalizeOverview reads the llm/web/commerce blocks + scope.org', () => {
    const raw = {
      range: '7d',
      interval: 'day',
      scope: { org: 'maxpower' },
      llm: {
        available: true,
        requests: 120,
        tokens: 4500,
        promptTokens: 3000,
        completionTokens: 1500,
        spendCents: 734,
        models: 3,
        providers: 2,
        errors: 2,
        errorRate: 0.017,
      },
      web: { available: false, reason: 'no web analytics events yet' },
      commerce: { available: false, reason: 'no commerce events yet' },
    }
    const o = normalizeOverview(raw)
    expect(o.org).toBe('maxpower')
    expect(o.llm.available).toBe(true)
    expect(o.llm.requests).toBe(120)
    expect(o.llm.spendCents).toBe(734)
    expect(o.llm.providers).toBe(2)
    expect(o.llm.errorRate).toBeCloseTo(0.017)
    // Honest-empty lenses: available=false, zeros, reason preserved.
    expect(o.web.available).toBe(false)
    expect(o.web.reason).toBe('no web analytics events yet')
    expect(o.web.pageviews).toBe(0)
    expect(o.commerce.available).toBe(false)
  })

  it('normalizeOverview degrades a missing/blank payload to honest zeros (never throws)', () => {
    const o = normalizeOverview(null)
    expect(o.llm.available).toBe(false)
    expect(o.llm.requests).toBe(0)
    expect(o.web.available).toBe(false)
    expect(o.commerce.available).toBe(false)
    expect(o.org).toBe('')
  })

  it('normalizeOverview coerces stringy numbers (transport drift) without throwing', () => {
    const o = normalizeOverview({ llm: { available: true, requests: '99', spendCents: '250' } })
    expect(o.llm.requests).toBe(99)
    expect(o.llm.spendCents).toBe(250)
  })

  it('normalizeSeries reads the series array (t/requests/tokens/spendCents)', () => {
    const raw = {
      series: [
        { t: '2026-06-01T00:00:00Z', requests: 10, tokens: 500, spendCents: 40 },
        { t: '2026-06-02T00:00:00Z', requests: 5, tokens: 200, spendCents: 15 },
      ],
    }
    const s = normalizeSeries(raw)
    expect(s).toHaveLength(2)
    expect(s[0].spendCents).toBe(40)
    expect(s[1].requests).toBe(5)
  })

  it('normalizeSeries returns [] for a missing series (honest-empty, no throw)', () => {
    expect(normalizeSeries({})).toEqual([])
    expect(normalizeSeries(undefined)).toEqual([])
  })

  it('normalizeTop reads real models (llm) + honest-empty products (commerce)', () => {
    const raw = {
      models: {
        available: true,
        items: [
          { model: 'gpt-4o', provider: 'openai', requests: 80, tokens: 3000, spendCents: 500, pct: 68.1 },
          { model: 'zen-nano', provider: 'hanzo', requests: 40, tokens: 1500, spendCents: 234, pct: 31.9 },
        ],
      },
      products: { available: false, reason: 'no commerce events yet', items: [] },
    }
    const t = normalizeTop(raw)
    expect(t.models.available).toBe(true)
    expect(t.models.items).toHaveLength(2)
    expect(t.models.items[0].model).toBe('gpt-4o')
    expect(t.models.items[0].pct).toBeCloseTo(68.1)
    expect(t.products.available).toBe(false)
    expect(t.products.items).toEqual([])
  })

  it('normalizeTop never throws on a drifted/absent models payload', () => {
    const t = normalizeTop({ models: {}, products: null })
    expect(t.models.available).toBe(false)
    expect(t.models.items).toEqual([])
    expect(t.products.items).toEqual([])
  })
})
