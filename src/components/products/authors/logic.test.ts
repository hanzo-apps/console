import { describe, it, expect } from 'vitest'

import { usd, sharePct, statusLabel, statusTone, statusColor, verifyMethodLabel, shortDate, payoutMethodLabel, dollarsToCents } from './logic'

describe('authors logic — money/share/label/tone formatting', () => {
  it('formats USD cents, em-dash for non-finite', () => {
    expect(usd(2000)).toBe('$20.00')
    expect(usd(0)).toBe('$0.00')
    expect(usd(null)).toBe('—')
    expect(usd(undefined)).toBe('—')
    expect(usd(NaN)).toBe('—')
  })

  it('formats basis points as a share percent', () => {
    expect(sharePct(500)).toBe('5%')
    expect(sharePct(2000)).toBe('20%')
    expect(sharePct(1550)).toBe('15.5%')
    expect(sharePct(null)).toBe('—')
    expect(sharePct(NaN)).toBe('—')
  })

  it('labels each status', () => {
    expect(statusLabel('connected')).toBe('Connected')
    expect(statusLabel('approved')).toBe('Approved')
    expect(statusLabel('suspended')).toBe('Suspended')
    expect(statusLabel('weird' as never)).toBe('weird')
  })

  it('tones each status by meaning, not hue', () => {
    expect(statusTone('approved')).toBe('positive')
    expect(statusTone('connected')).toBe('warning')
    expect(statusTone('suspended')).toBe('critical')
    expect(statusTone('other' as never)).toBe('muted')
  })

  it('colors a status from the one greyscale map', () => {
    for (const s of ['approved', 'connected', 'suspended', 'other'] as const)
      expect(statusColor(s as never)).toMatch(/^\$color(9|10|11|12)$/)
    expect(statusColor('suspended')).toBe('$color12')
    expect(statusColor('other' as never)).toBe('$color9')
  })

  it('labels the verify method', () => {
    expect(verifyMethodLabel('oauth')).toBe('GitHub OAuth')
    expect(verifyMethodLabel('file')).toBe('hanzo.json file')
    expect(verifyMethodLabel('')).toBe('Unverified')
    expect(verifyMethodLabel('weird' as never)).toBe('weird')
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
})
