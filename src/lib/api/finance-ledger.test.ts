import { describe, it, expect } from 'vitest'

import { financeUrl, unwrapEnvelope } from './finance-ledger'

/**
 * The console finance transport addresses the `/v1` user-bearer proxy (a cookie-only
 * bare `/v1/*` 403s on the live ingress) and unwraps a casibase envelope. The data
 * contract + normalizers live in the SHARED `@hanzo/finance-ui` package (tested there),
 * so these pin only console's transport wiring.
 */
describe('financeUrl — /v1 bearer BFF address (SSR, no window)', () => {
  it('addresses each read where it is served', () => {
    expect(financeUrl('credits')).toBe('/v1/billing/credits')
    expect(financeUrl('invoices')).toBe('/v1/billing/invoices')
    expect(financeUrl('payment-methods')).toBe('/v1/billing/methods')
    expect(financeUrl('treasury')).toBe('/v1/treasury')
  })
  it('appends a query, skipping undefined values', () => {
    expect(financeUrl('ledger', { range: '7d' })).toBe('/v1/billing/ledger?range=7d')
    expect(financeUrl('ledger', { range: undefined })).toBe('/v1/billing/ledger')
  })
  it('refuses a read nothing serves rather than answering a different question', () => {
    for (const head of ['balance', 'usage']) expect(() => financeUrl(head)).toThrow(/serves no/)
  })
})

describe('unwrapEnvelope', () => {
  it('unwraps a casibase { status, msg, data } envelope', () => {
    expect(unwrapEnvelope({ status: 'ok', msg: '', data: { availableCents: 500 } })).toEqual({ availableCents: 500 })
  })
  it('passes a bare payload through', () => {
    expect(unwrapEnvelope([{ id: 'a' }])).toEqual([{ id: 'a' }])
    expect(unwrapEnvelope({ availableCents: 5 })).toEqual({ availableCents: 5 })
  })
})
