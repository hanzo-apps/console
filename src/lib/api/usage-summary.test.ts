import { describe, it, expect, afterEach, vi } from 'vitest'
import { UsageSummaryApi, categoryLabel, normalizeSummary } from './usage-summary'

const ORIGIN = 'https://console.hanzo.ai'

function stubJson(body: unknown, status = 200): { url: string } {
  const captured = { url: '' }
  ;(globalThis as { window?: unknown }).window = {
    location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  }
  vi.stubGlobal('fetch', (url: string) => {
    captured.url = String(url)
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  })
  return captured
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as { window?: unknown }).window
})

describe('normalizeSummary — defensive, never throws', () => {
  it('maps a full backend payload (scope.org, spend, llm, sources)', () => {
    const s = normalizeSummary({
      range: '30d', start: 'A', end: 'B', interval: 'day', scope: { org: 'maxpower' },
      spend: {
        available: true, totalCents: 650, mtdCents: 5000, overageCents: 100,
        balanceCents: 20000, availableCents: 15000,
        byCategory: [{ category: 'GPU', cents: 450, count: 2 }, { category: 'LLM', cents: 200, count: 1 }],
        series: [{ t: 'T1', cents: 500 }, { t: 'T2', cents: 150 }],
      },
      llm: { available: true, requests: 12, tokens: 3400, promptTokens: 3000, completionTokens: 400, costCents: 87, models: 3 },
      sources: { commerce: true, warehouse: false },
    })
    expect(s.org).toBe('maxpower')
    expect(s.spend.totalCents).toBe(650)
    expect(s.spend.availableCents).toBe(15000)
    expect(s.spend.byCategory).toHaveLength(2)
    expect(s.spend.byCategory[0]).toEqual({ category: 'GPU', cents: 450, count: 2 })
    expect(s.spend.series[0]).toEqual({ t: 'T1', cents: 500 })
    expect(s.llm.tokens).toBe(3400)
    expect(s.sources).toEqual({ commerce: true, warehouse: false })
  })

  it('degrades a garbage/empty payload to honest zeros + empty arrays', () => {
    const s = normalizeSummary(null)
    expect(s.spend.available).toBe(false)
    expect(s.spend.totalCents).toBe(0)
    expect(s.spend.byCategory).toEqual([])
    expect(s.spend.series).toEqual([])
    expect(s.llm.available).toBe(false)
    expect(s.sources).toEqual({ commerce: false, warehouse: false })
  })

  it('coerces string-number cells and ignores non-object array entries', () => {
    const s = normalizeSummary({ spend: { totalCents: '999', byCategory: [null, { category: 'X', cents: '5' }, 3] } })
    expect(s.spend.totalCents).toBe(999)
    expect(s.spend.byCategory).toEqual([{ category: 'X', cents: 5, count: 0 }])
  })
})

describe('UsageSummaryApi.summary — same-origin /v1/usage/summary', () => {
  it('GETs the clean origin URL with the range and decodes the payload', async () => {
    const cap = stubJson({ scope: { org: 'maxpower' }, spend: { available: true, totalCents: 42 }, sources: { commerce: true } })
    const s = await UsageSummaryApi.summary('7d')
    expect(cap.url).toBe(`${ORIGIN}/v1/usage/summary?range=7d`)
    expect(s.org).toBe('maxpower')
    expect(s.spend.totalCents).toBe(42)
  })

  it('passes custom start/end through', async () => {
    const cap = stubJson({})
    await UsageSummaryApi.summary('30d', { start: '2026-07-01', end: '2026-07-03' })
    expect(cap.url).toContain('range=30d')
    expect(cap.url).toContain('start=2026-07-01')
    expect(cap.url).toContain('end=2026-07-03')
  })
})

/**
 * The breakdown came back as 327 rows of `Act_281fc47082a8f1e4649ca8607e567740`, each
 * one line of spend, rendered verbatim — a bill nobody can read. The response carries
 * no name for them (the row is `{category, cents, count}` and nothing else), so the
 * only honest move is to shorten the id, never to invent a word for it.
 */
describe('categoryLabel — shorten an opaque id, never rename it', () => {
  it('shortens a commerce id to its tag plus a recognizable head', () => {
    expect(categoryLabel('Act_281fc47082a8f1e4649ca8607e567740')).toBe('Act_281fc470…')
    expect(categoryLabel('use_a3c131f74e2b1d9c0f8e6a5b4c3d2e1f')).toBe('use_a3c131f7…')
  })

  it('keeps distinct ids distinct (the head is long enough to tell them apart)', () => {
    const a = categoryLabel('Act_281fc47082a8f1e4649ca8607e567740')
    const b = categoryLabel('Act_281fc47182a8f1e4649ca8607e567740')
    expect(a).not.toBe(b)
  })

  // If billing ever sends a real word, it must survive untouched — this only ever
  // shortens what was unreadable to begin with.
  it('passes a human category through unchanged', () => {
    for (const name of ['GPU', 'LLM', 'Storage', 'Egress', 'Compute time']) {
      expect(categoryLabel(name)).toBe(name)
    }
  })

  it('leaves anything that is not a tag_hex id alone', () => {
    expect(categoryLabel('')).toBe('')
    expect(categoryLabel('Act_short')).toBe('Act_short')
    expect(categoryLabel('no-underscore-here')).toBe('no-underscore-here')
    expect(categoryLabel('Act_281FC47082A8F1E4649CA8607E567740')).toBe('Act_281FC47082A8F1E4649CA8607E567740')
  })
})
