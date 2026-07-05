/**
 * AdminGrantsApi.create — the success-banner amount fix. The cloud create response
 * does not always echo the requested amount/source, which made the Grants banner
 * read "$0.00" even though the ledger recorded the real amount. `create` must
 * backfill the REQUESTED values so the returned row (which the banner renders) is
 * self-consistent whatever the response shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const originPost = vi.fn()
vi.mock('./client', () => ({
  originGet: vi.fn(),
  originPost: (...a: unknown[]) => originPost(...a),
}))

import { AdminGrantsApi } from './admin-grants'

describe('AdminGrantsApi.create — request values backfill an amount-less response', () => {
  beforeEach(() => originPost.mockReset())

  it('uses the requested amount + source when the response omits them (the "$0.00 banner" bug)', async () => {
    // The observed live create response: a transaction, but NO amountCents / source.
    originPost.mockResolvedValueOnce({ org: 'acme', transactionId: 'tx_123', result: 'granted' })
    const g = await AdminGrantsApi.create({ org: 'acme', amountCents: 100, source: 'trial', reason: 'welcome' })
    expect(g.amountCents).toBe(100) // NOT 0 — the banner now shows $1.00
    expect(g.source).toBe('trial')
    expect(g.org).toBe('acme')
    expect(g.transactionId).toBe('tx_123')
  })

  it('preserves the operator-selected prepaid source even when the response defaults it', async () => {
    originPost.mockResolvedValueOnce({ transactionId: 'tx_9' }) // no source echoed
    const g = await AdminGrantsApi.create({ org: 'acme', amountCents: 5000, source: 'prepaid' })
    expect(g.source).toBe('prepaid')
    expect(g.amountCents).toBe(5000)
  })

  it('prefers a real amount the response DOES echo over the request', async () => {
    originPost.mockResolvedValueOnce({ org: 'acme', amountCents: 250, source: 'trial', transactionId: 'tx_1' })
    const g = await AdminGrantsApi.create({ org: 'acme', amountCents: 100, source: 'trial' })
    expect(g.amountCents).toBe(250)
  })
})
