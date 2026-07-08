import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { AffiliatesApi, normalizeOverview, normalizePayout, normalizeApply, normalizeAttribute } from './affiliates'

/**
 * Affiliates API + pure normalizers. The client calls the cloud `/v1/affiliates`
 * contract through the console's `/v1` user-bearer proxy (`cloudProxyV1Url` →
 * `<origin>/v1/affiliates` — the live-ingress-safe form for a bearer-scoped
 * head; a bare `/v1/affiliates` 403s on the gateway). These tests pin (1) that each
 * call hits the EXACT `/v1/affiliates…` path, (2) the real store JSON shape
 * normalizes, and (3) a garbage/absent field degrades to a safe default.
 */
const ORIGIN = 'https://console.hanzo.ai'

describe('Affiliates normalizers — real cloud JSON shape, defensive', () => {
  it('normalizes the enrolled overview with all fields', () => {
    const o = normalizeOverview({
      isAffiliate: true,
      id: 'aff_1',
      status: 'approved',
      code: 'acme',
      requestedCode: 'acme',
      link: 'https://hanzo.ai/?aff=acme',
      rateBps: 2000,
      referredCount: 3,
      accruedCents: 4200,
      pendingCents: 1200,
      paidCents: 3000,
      payouts: [
        { id: 'apo_1', amountCents: 3000, method: 'credits', reference: 'x', txn: 'txn_9', createdAt: 5 },
        { id: 'apo_2', amountCents: 500, method: 'wire', reference: '', txn: '', createdAt: 6 },
      ],
    })
    expect(o).toMatchObject({
      isAffiliate: true,
      id: 'aff_1',
      status: 'approved',
      code: 'acme',
      link: 'https://hanzo.ai/?aff=acme',
      rateBps: 2000,
      referredCount: 3,
      accruedCents: 4200,
      pendingCents: 1200,
      paidCents: 3000,
    })
    expect(o.payouts.map((p) => p.id)).toEqual(['apo_1', 'apo_2'])
    expect(o.payouts[0].method).toBe('credits')
  })

  it('normalizes the NOT-enrolled shape (apply-form state)', () => {
    const o = normalizeOverview({ isAffiliate: false, defaultRateBps: 2000 })
    expect(o.isAffiliate).toBe(false)
    expect(o.defaultRateBps).toBe(2000)
    expect(o.payouts).toEqual([])
  })

  it('coerces missing/garbage fields to safe defaults (never throws)', () => {
    const o = normalizeOverview(null)
    expect(o).toMatchObject({ isAffiliate: false, code: '', link: '', accruedCents: 0, pendingCents: 0, paidCents: 0 })
    expect(o.defaultRateBps).toBe(2000) // sensible fallback when absent
    expect(o.payouts).toEqual([])
    // A payout row with no id is filtered out.
    expect(
      normalizeOverview({ payouts: [null, 'x', { id: 'apo_9', amountCents: 1 }] }).payouts.map((p) => p.id),
    ).toEqual(['apo_9'])
    // A row defaults status to applied.
    expect(normalizeOverview({ isAffiliate: true }).status).toBe('applied')
    // Numeric coercion from strings.
    expect(normalizePayout({ id: 'p', amountCents: '1500' }).amountCents).toBe(1500)
  })

  it('normalizes apply + attribute results (strict-boolean created)', () => {
    expect(normalizeApply({ id: 'aff_1', status: 'applied', requestedCode: 'acme', rateBps: 2000, created: true })).toEqual({
      id: 'aff_1',
      status: 'applied',
      code: '',
      requestedCode: 'acme',
      rateBps: 2000,
      created: true,
    })
    expect(normalizeApply({ id: 'x' }).created).toBe(false)
    expect(normalizeAttribute({ id: 'afr_1', code: 'acme', created: true, createdAt: 9 })).toEqual({
      id: 'afr_1',
      code: 'acme',
      created: true,
      createdAt: 9,
    })
    expect(normalizeAttribute({ id: 'x' }).created).toBe(false)
  })
})

describe('AffiliatesApi — hits the /v1/affiliates bearer-proxy path', () => {
  const fetched: { url: string; method: string; body: string }[] = []

  beforeEach(() => {
    fetched.length = 0
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    }
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      const body = url.endsWith('/apply')
        ? { id: 'aff_1', status: 'applied', code: '', requestedCode: 'acme', rateBps: 2000, created: true }
        : url.endsWith('/attribute')
          ? { id: 'afr_1', code: 'acme', created: true, createdAt: 1 }
          : { isAffiliate: true, code: 'acme', link: 'https://hanzo.ai/?aff=acme', payouts: [] }
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('reads the overview via the /v1 bearer BFF (prefix-free /v1, never a /cloud-prefixed or direct cloud-origin call)', async () => {
    const out = await AffiliatesApi.overview()
    expect(fetched[0]).toEqual({ url: `${ORIGIN}/v1/affiliates`, method: 'GET', body: '' })
    expect(out.code).toBe('acme')
  })

  it('applies with POST through the proxy', async () => {
    const r = await AffiliatesApi.apply('acme')
    expect(fetched[0].url).toBe(`${ORIGIN}/v1/affiliates/apply`)
    expect(fetched[0].method).toBe('POST')
    expect(fetched[0].body).toContain('acme')
    expect(r.created).toBe(true)
  })

  it('attributes with POST through the proxy', async () => {
    const r = await AffiliatesApi.attribute('acme')
    expect(fetched[0].url).toBe(`${ORIGIN}/v1/affiliates/attribute`)
    expect(fetched[0].method).toBe('POST')
    expect(fetched[0].body).toContain('acme')
    expect(r.created).toBe(true)
  })
})
