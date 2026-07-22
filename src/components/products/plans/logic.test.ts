import { describe, expect, it } from 'vitest'

import { annualDisplay, PLAN_CATEGORIES, priceDisplay } from './logic'

describe('plan price display (free vs custom)', () => {
  it('shows a real monthly price', () => {
    expect(priceDisplay(2000, false)).toBe('$20.00/mo')
    expect(priceDisplay(800, false)).toBe('$8.00/mo')
  })
  it('distinguishes free ($0) from custom (contactSales)', () => {
    expect(priceDisplay(0, false)).toBe('Free') // free tier
    expect(priceDisplay(0, true)).toBe('Contact sales') // custom / null price
  })
  it('contactSales wins over a stored price (custom, not the number)', () => {
    expect(priceDisplay(50000, true)).toBe('Contact sales')
  })
})

describe('annual display', () => {
  it('renders a distinct annual per-month price', () => {
    expect(annualDisplay(1600)).toBe('$16.00/mo billed annually')
  })
  it('is empty when there is no annual price', () => {
    expect(annualDisplay(0)).toBe('')
  })
})

describe('plan categories', () => {
  it('are the commerce plan families', () => {
    expect(PLAN_CATEGORIES).toContain('personal')
    expect(PLAN_CATEGORIES).toContain('team')
    expect(PLAN_CATEGORIES).toContain('dns')
    expect(PLAN_CATEGORIES).toContain('enterprise')
  })
})
