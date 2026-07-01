import { describe, expect, it } from 'vitest'

import { deriveStoreStats, humanizeStatus, statusTone, discountValue } from './logic'
import type { CommerceProduct, CommerceOrder, CommerceCustomer } from '~/lib/api/commerce'

const product = (p: Partial<CommerceProduct>): CommerceProduct => ({
  id: 'p',
  name: 'P',
  available: true,
  hidden: false,
  ...p,
})
const order = (o: Partial<CommerceOrder>): CommerceOrder => ({ id: 'o', ...o })
const customer = (c: Partial<CommerceCustomer>): CommerceCustomer => ({ id: 'c', ...c })

describe('deriveStoreStats', () => {
  it('counts products, active products, orders, customers and sums revenue', () => {
    const stats = deriveStoreStats(
      [
        product({ id: '1', available: true, hidden: false }),
        product({ id: '2', available: true, hidden: true }), // hidden → not active
        product({ id: '3', available: false, hidden: false }), // unavailable → not active
      ],
      [order({ id: 'a', totalCents: 1299 }), order({ id: 'b', totalCents: 500 }), order({ id: 'c' })],
      [customer({ id: 'x' }), customer({ id: 'y' })],
    )
    expect(stats).toEqual({ products: 3, activeProducts: 1, orders: 3, customers: 2, revenueCents: 1799 })
  })

  it('is all-zero for an empty store (honest, never fabricated)', () => {
    expect(deriveStoreStats([], [], [])).toEqual({
      products: 0,
      activeProducts: 0,
      orders: 0,
      customers: 0,
      revenueCents: 0,
    })
  })
})

describe('humanizeStatus', () => {
  it('title-cases snake/kebab tokens', () => {
    expect(humanizeStatus('payment_pending')).toBe('Payment Pending')
    expect(humanizeStatus('fulfilled')).toBe('Fulfilled')
    expect(humanizeStatus('partially-refunded')).toBe('Partially Refunded')
  })
  it('returns an em dash for a missing status', () => {
    expect(humanizeStatus(undefined)).toBe('—')
    expect(humanizeStatus('')).toBe('—')
  })
})

describe('statusTone', () => {
  it('maps settled/success states to green', () => {
    for (const s of ['paid', 'complete', 'fulfilled', 'active', 'captured']) expect(statusTone(s)).toBe('green')
  })
  it('maps in-flight states to yellow', () => {
    for (const s of ['pending', 'processing', 'open', 'draft']) expect(statusTone(s)).toBe('yellow')
  })
  it('maps failure states to red', () => {
    for (const s of ['failed', 'cancelled', 'refunded', 'declined']) expect(statusTone(s)).toBe('red')
  })
  it('never fabricates OK for an unknown status (gray)', () => {
    expect(statusTone('something-else')).toBe('gray')
    expect(statusTone(undefined)).toBe('gray')
  })
})

describe('discountValue', () => {
  it('renders percent types as a percentage', () => {
    expect(discountValue('percentage', 15)).toBe('15%')
    expect(discountValue('percent', 20)).toBe('20%')
  })
  it('renders fixed types as USD from cents', () => {
    expect(discountValue('fixed', 500)).toBe('$5.00')
    expect(discountValue('amount', 1299)).toBe('$12.99')
  })
  it('infers percent vs amount when the type is absent', () => {
    expect(discountValue(undefined, 25)).toBe('25%') // small → percent
    expect(discountValue(undefined, 1500)).toBe('$15.00') // large → cents
  })
  it('is an em dash when there is no value', () => {
    expect(discountValue('percent', undefined)).toBe('—')
  })
})
