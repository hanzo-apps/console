import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { BillingApi, type PaymentMethod, type Subscription } from './billing'

const ORIGIN = 'https://console.hanzo.ai'

/** Stub `window` + a single JSON `fetch` response, shared by the read-only suites. */
function stubJson(body: unknown, status = 200): void {
  ;(globalThis as { window?: unknown }).window = {
    location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  }
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  )
}

function teardown(): void {
  vi.unstubAllGlobals()
  delete (globalThis as { window?: unknown }).window
}

/**
 * Regression: the Cost page's "Usage by product" must read the REAL commerce
 * api-usage ledger correctly — per-model rows from `metadata.model` (not a single
 * generic "Usage" row) and cost from `amount` cents (NOT amount×100, the old
 * dollars-vs-cents bug that turned $0.01 into $1.00). Driven through the same
 * `/billing/usage` per-tenant proxy the page uses.
 */

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

/**
 * Subscriptions — read-only over the same per-tenant `/billing/*` proxy. Commerce
 * is Stripe-shaped, so the normalizer must reach the plan name + price from a flat
 * `plan`, a nested `plan.nickname`, or the first `items.data[].price`, and must
 * treat `current_period_end` as either a Unix epoch (seconds) or an ISO string.
 */
describe('BillingApi.subscriptions — Stripe-shaped commerce mapping', () => {
  afterEach(teardown)

  it('reads plan/status/quantity/price from a nested Stripe subscription', async () => {
    stubJson({
      subscriptions: [
        {
          id: 'sub_1',
          status: 'active',
          quantity: 5,
          current_period_end: 1893456000, // 2030-01-01 in epoch SECONDS
          plan: { nickname: 'Team', amount: 2000, interval: 'month' },
        },
      ],
    })
    const subs = await BillingApi.subscriptions()
    expect(subs).toHaveLength(1)
    const s: Subscription = subs[0]
    expect(s.id).toBe('sub_1')
    expect(s.plan).toBe('Team')
    expect(s.status).toBe('active')
    expect(s.quantity).toBe(5)
    expect(s.cents).toBe(2000)
    expect(s.interval).toBe('month')
    // epoch seconds → a real ISO date (not fabricated, not NaN).
    expect(s.currentPeriodEnd).toBe(new Date(1893456000 * 1000).toISOString())
  })

  it('falls back to items[].price for the plan name + unit_amount', async () => {
    stubJson({
      data: [
        {
          id: 'sub_2',
          status: 'trialing',
          items: { data: [{ quantity: 1, price: { nickname: 'Pro', unit_amount: 4900, recurring: { interval: 'year' } } }] },
        },
      ],
    })
    const [s] = await BillingApi.subscriptions()
    expect(s.plan).toBe('Pro')
    expect(s.cents).toBe(4900)
    expect(s.interval).toBe('year')
  })

  it('degrades an unnamed subscription to "—" and undefined price, never invents', async () => {
    stubJson({ subscriptions: [{ id: 'sub_3', status: 'past_due' }] })
    const [s] = await BillingApi.subscriptions()
    expect(s.plan).toBe('—')
    expect(s.cents).toBeUndefined()
    expect(s.currentPeriodEnd).toBeUndefined()
  })

  it('is honest-empty for an org with no subscriptions', async () => {
    stubJson({ subscriptions: [] })
    expect(await BillingApi.subscriptions()).toEqual([])
  })
})

/**
 * Payment methods — read-only + MASKED. The normalizer must surface ONLY the
 * non-sensitive descriptor (brand + last4 + expiry) commerce returns, from either
 * camelCase or Stripe snake_case, and must never produce a PAN/CVV/token (none is
 * present in the payload).
 */
describe('BillingApi.paymentMethods — masked descriptor mapping', () => {
  afterEach(teardown)

  it('reads brand/last4/expiry/default from a nested Stripe card (snake_case)', async () => {
    stubJson({
      payment_methods: [
        { id: 'pm_1', type: 'card', is_default: true, card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
      ],
    })
    const methods = await BillingApi.paymentMethods()
    expect(methods).toHaveLength(1)
    const m: PaymentMethod = methods[0]
    expect(m.brand).toBe('visa')
    expect(m.last4).toBe('4242')
    expect(m.expMonth).toBe(12)
    expect(m.expYear).toBe(2030)
    expect(m.isDefault).toBe(true)
  })

  it('reads a flat camelCase method shape', async () => {
    stubJson({ paymentMethods: [{ id: 'pm_2', brand: 'mastercard', last4: '5555', expMonth: 3, expYear: 2029, isDefault: false }] })
    const [m] = await BillingApi.paymentMethods()
    expect(m.brand).toBe('mastercard')
    expect(m.last4).toBe('5555')
    expect(m.isDefault).toBe(false)
  })

  it('NEVER exposes a full PAN / CVV / token — only last4 survives normalization', async () => {
    // A hostile/rich payload: even if a raw PAN, cvc, or token appears upstream,
    // the display shape carries ONLY the masked descriptor. Assert the leak fields
    // are absent from every normalized object.
    stubJson({
      data: [
        {
          id: 'pm_3',
          card: { brand: 'amex', last4: '0005', exp_month: 1, exp_year: 2031, number: '378282246310005', cvc: '1234' },
          token: 'tok_secret_should_never_surface',
        },
      ],
    })
    const [m] = await BillingApi.paymentMethods()
    expect(m.last4).toBe('0005')
    expect(m.brand).toBe('amex')
    const keys = Object.keys(m)
    for (const leak of ['number', 'pan', 'cvc', 'cvv', 'token', 'card']) {
      expect(keys).not.toContain(leak)
    }
    // And no value on the object equals the raw secret.
    for (const v of Object.values(m)) expect(v).not.toBe('378282246310005')
    for (const v of Object.values(m)) expect(v).not.toBe('tok_secret_should_never_surface')
  })

  it('degrades a method with no card descriptor to undefined fields, never fabricated', async () => {
    stubJson({ data: [{ id: 'pm_4', type: 'bank_account' }] })
    const [m] = await BillingApi.paymentMethods()
    expect(m.last4).toBeUndefined()
    expect(m.brand).toBeUndefined()
    expect(m.expMonth).toBeUndefined()
  })

  it('is honest-empty for an org with no payment methods', async () => {
    stubJson({ paymentMethods: [] })
    expect(await BillingApi.paymentMethods()).toEqual([])
  })
})
