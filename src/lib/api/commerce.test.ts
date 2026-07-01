import { describe, expect, it } from 'vitest'

import {
  normalizeProduct,
  normalizeOrder,
  normalizeCustomer,
  normalizeVariant,
  normalizeDiscount,
  normalizeStore,
} from './commerce'

describe('normalizeProduct', () => {
  it('maps the real commerce product shape (price in cents, availability flags)', () => {
    const p = normalizeProduct({
      id: 'rgI4qRNmlIK',
      name: 'MaxPower Logo Tee',
      sku: 'MP-TEE-001',
      slug: 'maxpower-tee',
      price: 2500,
      currency: 'USD',
      inventory: 12,
      available: true,
      hidden: false,
      createdAt: '2026-07-01T21:32:32Z',
    })
    expect(p).toMatchObject({
      id: 'rgI4qRNmlIK',
      name: 'MaxPower Logo Tee',
      sku: 'MP-TEE-001',
      priceCents: 2500,
      inventory: 12,
      available: true,
      hidden: false,
    })
  })
  it('falls back name → slug/sku and never throws on a sparse record', () => {
    expect(normalizeProduct({ sku: 'X' }).name).toBe('X')
    expect(normalizeProduct({}).name).toBe('(unnamed)')
    expect(normalizeProduct(null).available).toBe(false)
  })
})

describe('normalizeOrder', () => {
  it('reads a nested customer and a total in cents', () => {
    const o = normalizeOrder({
      id: 'o1',
      number: '1001',
      customer: { name: 'Jane Merchant', email: 'jane@x.test' },
      total: 4200,
      status: 'paid',
      createdAt: '2026-07-01T00:00:00Z',
    })
    expect(o).toMatchObject({ id: 'o1', number: '1001', customer: 'Jane Merchant', totalCents: 4200, status: 'paid' })
  })
  it('defaults the display number to the id when absent', () => {
    expect(normalizeOrder({ id: 'abc' }).number).toBe('abc')
  })
})

describe('normalizeCustomer', () => {
  it('composes first + last into a full name', () => {
    expect(normalizeCustomer({ id: 'c', firstName: 'Jane', lastName: 'Merchant', email: 'j@x.test' })).toMatchObject({
      name: 'Jane Merchant',
      email: 'j@x.test',
    })
  })
  it('prefers an explicit name and tolerates a missing one', () => {
    expect(normalizeCustomer({ id: 'c', name: 'Acme Buyer' }).name).toBe('Acme Buyer')
    expect(normalizeCustomer({ id: 'c' }).name).toBeUndefined()
  })
})

describe('normalizeVariant / normalizeStore', () => {
  it('maps a variant SKU + inventory + price', () => {
    expect(normalizeVariant({ id: 'v', sku: 'MP-TEE-001-S', inventory: 3, price: 2500 })).toMatchObject({
      sku: 'MP-TEE-001-S',
      inventory: 3,
      priceCents: 2500,
    })
  })
  it('maps a store name + currency', () => {
    expect(normalizeStore({ id: 's', name: 'MaxPower Store', currency: 'USD' })).toMatchObject({
      name: 'MaxPower Store',
      currency: 'USD',
    })
  })
})

describe('normalizeDiscount', () => {
  it('reads code, type, value and an active flag', () => {
    expect(normalizeDiscount({ id: 'd', code: 'SAVE15', type: 'percentage', value: 15, active: true })).toMatchObject({
      code: 'SAVE15',
      type: 'percentage',
      value: 15,
      active: true,
    })
  })
  it('treats a disabled flag as inactive', () => {
    expect(normalizeDiscount({ id: 'd', code: 'OLD', disabled: true }).active).toBe(false)
  })
})
