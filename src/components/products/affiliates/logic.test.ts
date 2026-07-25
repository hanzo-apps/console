import { describe, it, expect } from 'vitest'

import { usd, ratePct, statusLabel, statusTone, statusColor, shortDate, payoutMethodLabel, dollarsToCents, monthLabel, percentToBps } from './logic'

describe('affiliates logic — money/rate/label/tone formatting', () => {
  it('formats USD cents, em-dash for non-finite', () => {
    expect(usd(2000)).toBe('$20.00')
    expect(usd(0)).toBe('$0.00')
    expect(usd(null)).toBe('—')
    expect(usd(undefined)).toBe('—')
    expect(usd(NaN)).toBe('—')
  })

  it('formats basis points as a percent', () => {
    expect(ratePct(2000)).toBe('20%')
    expect(ratePct(1550)).toBe('15.5%')
    expect(ratePct(500)).toBe('5%')
    expect(ratePct(null)).toBe('—')
    expect(ratePct(NaN)).toBe('—')
  })

  it('labels each status', () => {
    expect(statusLabel('applied')).toBe('Applied')
    expect(statusLabel('approved')).toBe('Approved')
    expect(statusLabel('suspended')).toBe('Suspended')
    expect(statusLabel('weird' as never)).toBe('weird')
  })

  it('tones each status by meaning, not hue', () => {
    expect(statusTone('approved')).toBe('positive')
    expect(statusTone('applied')).toBe('warning')
    expect(statusTone('suspended')).toBe('critical')
    expect(statusTone('other' as never)).toBe('muted')
  })

  it('colors a status from the one greyscale map', () => {
    for (const s of ['approved', 'applied', 'suspended', 'other'] as const)
      expect(statusColor(s as never)).toMatch(/^\$color(9|10|11|12)$/)
    // Suspended must out-emphasise approved — weight carries the alarm.
    expect(statusColor('suspended')).toBe('$color12')
    expect(statusColor('other' as never)).toBe('$color9')
  })

  it('formats a short date, em-dash when unset', () => {
    expect(shortDate(0)).toBe('—')
    expect(shortDate(1_700_000_000)).toMatch(/\d{4}/)
  })

  it('labels payout methods', () => {
    expect(payoutMethodLabel('credits')).toBe('Cloud credit')
    expect(payoutMethodLabel('wire')).toBe('Wire')
    expect(payoutMethodLabel('paypal')).toBe('PayPal')
    expect(payoutMethodLabel('ach')).toBe('ACH')
    expect(payoutMethodLabel('bank')).toBe('Bank')
    expect(payoutMethodLabel('')).toBe('—')
  })

  it('parses dollars → cents (null on blank/invalid)', () => {
    expect(dollarsToCents('20')).toBe(2000)
    expect(dollarsToCents('20.00')).toBe(2000)
    expect(dollarsToCents('$12.34')).toBe(1234)
    expect(dollarsToCents('0.01')).toBe(1)
    expect(dollarsToCents('')).toBeNull()
    expect(dollarsToCents('abc')).toBeNull()
    expect(dollarsToCents('0')).toBeNull()
    expect(dollarsToCents('-5')).toBeNull()
  })

  it('labels a YYYY-MM accrual period', () => {
    expect(monthLabel('2026-07')).toMatch(/2026/)
    expect(monthLabel('2026-07')).toMatch(/Jul/)
    expect(monthLabel('bogus')).toBe('bogus')
    expect(monthLabel('2026-13')).toBe('2026-13') // invalid month → passthrough
    expect(monthLabel('')).toBe('—')
  })

  it('parses a percent → basis points (null on blank/invalid/out-of-range)', () => {
    expect(percentToBps('20')).toBe(2000)
    expect(percentToBps('15.5')).toBe(1550)
    expect(percentToBps('93')).toBe(9300)
    expect(percentToBps('0')).toBe(0)
    expect(percentToBps('100')).toBe(10000)
    expect(percentToBps('20%')).toBe(2000)
    expect(percentToBps('')).toBeNull()
    expect(percentToBps('abc')).toBeNull()
    expect(percentToBps('-1')).toBeNull()
    expect(percentToBps('101')).toBeNull()
  })
})
