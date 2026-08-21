import { describe, it, expect } from 'vitest'

import { financeUrl, reshapeBalance, reshapeUsage, unwrapEnvelope } from './finance-ledger'

/**
 * The Finance dashboard's seven reads each address the capability that answers them —
 * `/v1/finance` was a second spelling and is gone, with no alias behind it. The data
 * contract + normalizers live in the SHARED `@hanzo/finance-ui` package (tested there),
 * so these pin console's addresses and the two reshapes the fold made necessary.
 */
describe('financeUrl — one address per read (SSR, no window)', () => {
  it('sends the money reads to billing', () => {
    expect(financeUrl('balance')).toBe('/v1/billing/balance')
    expect(financeUrl('credits')).toBe('/v1/billing/credits')
    expect(financeUrl('invoices')).toBe('/v1/billing/invoices')
    expect(financeUrl('payment-methods')).toBe('/v1/billing/methods')
    expect(financeUrl('ledger')).toBe('/v1/billing/ledger')
  })
  it('sends the reserve fund to treasury', () => {
    expect(financeUrl('treasury')).toBe('/v1/treasury')
  })
  it('never addresses /v1/finance', () => {
    for (const read of ['balance', 'credits', 'usage', 'invoices', 'payment-methods', 'ledger', 'treasury']) {
      expect(financeUrl(read)).not.toContain('/v1/finance')
    }
  })
  it('appends a query, skipping undefined values', () => {
    expect(financeUrl('usage', { range: '7d' })).toBe('/v1/billing/usage?range=7d')
    expect(financeUrl('ledger', { range: undefined })).toBe('/v1/billing/ledger')
  })
})

describe('reshapeBalance — holds is what pending named', () => {
  it('reads available + holds off the commerce wallet envelope', () => {
    expect(reshapeBalance({ balance: 900, holds: 400, available: 500, account: 'acme' })).toEqual({
      currency: 'usd',
      availableCents: 500,
      pendingCents: 400,
      dueCents: 0,
    })
  })
  it('degrades a missing wallet to zeros, never NaN', () => {
    expect(reshapeBalance({})).toEqual({ currency: 'usd', availableCents: 0, pendingCents: 0, dueCents: 0 })
  })
})

describe('reshapeUsage — per-call rows roll up to the window finance-ui reads', () => {
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
  const rows = {
    usage: [
      { id: 't1', amount: 300, createdAt: at(2), metadata: { product: 'agents', totalTokens: 100 } },
      { id: 't2', amount: 200, createdAt: at(3), metadata: { product: 'agents', totalTokens: 50 } },
      { id: 't3', amount: 50, createdAt: at(4), metadata: { model: 'gpt-4o-mini', totalTokens: 10 } },
    ],
  }

  it('totals the window and breaks it out by product, biggest first', () => {
    const u = reshapeUsage(rows, '7d') as {
      totalCents: number
      lines: { label: string; units: number; tokens: number; cents: number }[]
      series: { date: string; cents: number }[]
    }
    expect(u.totalCents).toBe(550)
    expect(u.lines[0]).toEqual({ label: 'agents', units: 2, tokens: 150, cents: 500 })
    expect(u.lines[1]).toEqual({ label: 'gpt-4o-mini', units: 1, tokens: 10, cents: 50 })
    expect(u.series.reduce((s, p) => s + p.cents, 0)).toBe(550)
  })

  it('drops rows outside the window rather than widening it', () => {
    const old = { usage: [{ id: 't0', amount: 999, createdAt: at(48), metadata: {} }] }
    expect((reshapeUsage(old, '24h') as { totalCents: number }).totalCents).toBe(0)
    expect((reshapeUsage(old, '7d') as { totalCents: number }).totalCents).toBe(999)
  })

  it('is honestly empty when the ledger is', () => {
    const u = reshapeUsage({ usage: [] }, '30d') as { totalCents: number; lines: unknown[]; series: unknown[] }
    expect(u).toMatchObject({ totalCents: 0, lines: [], series: [] })
  })
})

describe('unwrapEnvelope', () => {
  it('unwraps a casibase { status, msg, data } envelope', () => {
    expect(unwrapEnvelope({ status: 'ok', msg: '', data: { available: 500 } })).toEqual({ available: 500 })
  })
  it('passes a bare payload through', () => {
    expect(unwrapEnvelope([{ id: 'a' }])).toEqual([{ id: 'a' }])
    expect(unwrapEnvelope({ available: 5 })).toEqual({ available: 5 })
  })
})
