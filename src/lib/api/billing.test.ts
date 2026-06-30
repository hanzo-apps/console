import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { BillingApi } from './billing'

/**
 * Regression: the Cost page's "Usage by product" must read the REAL commerce
 * api-usage ledger correctly — per-model rows from `metadata.model` (not a single
 * generic "Usage" row) and cost from `amount` cents (NOT amount×100, the old
 * dollars-vs-cents bug that turned $0.01 into $1.00). Driven through the same
 * `/billing/usage` per-tenant proxy the page uses.
 */
const ORIGIN = 'https://console.hanzo.ai'

/** A real ledger record, exactly as `commerce billing.GetUsage` emits it. */
function rec(model: string, amountCents: number, totalTokens: number, transactionId: string) {
  return {
    transactionId,
    amount: amountCents,
    currency: 'usd',
    notes: `API usage: ${model} (${totalTokens} tokens)`,
    createdAt: '2026-06-24T04:42:19Z',
    metadata: { model, provider: 'do-ai', promptTokens: totalTokens - 1, completionTokens: 1, totalTokens, status: 'success', stream: false, requestId: 'r' },
  }
}

describe('BillingApi.usage — real ledger mapping (Cost page)', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            user: 'maxpower',
            count: 3,
            usage: [rec('gpt-4o-mini', 1, 39, 'a'), rec('gpt-4o', 5, 200, 'b'), rec('gpt-4o-mini', 1, 41, 'c')],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('groups by real model name, never a generic "Usage" row', async () => {
    const usage = await BillingApi.usage()
    const labels = usage.lines.map((l) => l.label).sort()
    expect(labels).toEqual(['gpt-4o', 'gpt-4o-mini'])
    expect(labels).not.toContain('Usage')
  })

  it('counts requests per model and sums tokens', async () => {
    const usage = await BillingApi.usage()
    const mini = usage.lines.find((l) => l.label === 'gpt-4o-mini')!
    expect(mini.units).toBe(2) // two records
    expect(mini.tokens).toBe(80) // 39 + 41
  })

  it('keeps amount in CENTS — no ×100 dollars bug', async () => {
    const usage = await BillingApi.usage()
    // total amount = 1 + 5 + 1 = 7 cents = $0.07 (NOT 700 cents / $7.00).
    expect(usage.totalCents).toBe(7)
    const mini = usage.lines.find((l) => l.label === 'gpt-4o-mini')!
    expect(mini.cents).toBe(2) // 1 + 1 cents
  })

  it('is honest-empty for an org with no usage', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ user: 'maxpower', count: 0, usage: [] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const usage = await BillingApi.usage()
    expect(usage.lines).toEqual([])
    expect(usage.totalCents).toBe(0)
  })
})
