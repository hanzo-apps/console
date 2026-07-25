import { describe, it, expect } from 'vitest'

import { usd, statusLabel, statusTone, statusColor, shortDate, progressCaption } from './logic'

describe('referrals logic — money/label/tone formatting', () => {
  it('formats USD cents, em-dash for non-finite', () => {
    expect(usd(1000)).toBe('$10.00')
    expect(usd(500)).toBe('$5.00')
    expect(usd(0)).toBe('$0.00')
    expect(usd(null)).toBe('—')
    expect(usd(undefined)).toBe('—')
    expect(usd(NaN)).toBe('—')
  })

  it('labels each status', () => {
    expect(statusLabel('signed_up')).toBe('Signed up')
    expect(statusLabel('qualified')).toBe('Qualified')
    expect(statusLabel('credited')).toBe('Credited')
    expect(statusLabel('weird' as never)).toBe('weird')
  })

  it('tones by status (credited positive, qualified warning, signed_up muted)', () => {
    expect(statusTone('credited')).toBe('positive')
    expect(statusTone('qualified')).toBe('warning')
    expect(statusTone('signed_up')).toBe('muted')
  })

  it('colors a status from the one greyscale map', () => {
    for (const s of ['credited', 'qualified', 'signed_up'] as const)
      expect(statusColor(s)).toMatch(/^\$color(9|10|11|12)$/)
    expect(statusColor('signed_up')).toBe('$color9')
  })

  it('short-dates a unix second, em-dash for unset', () => {
    expect(shortDate(0)).toBe('—')
    expect(shortDate(1_700_000_000)).not.toBe('—')
  })

  it('captions progress honestly per status', () => {
    expect(progressCaption({ id: 'a', referee: 'x', status: 'credited', creditsCents: 1000, createdAt: 1, qualifiedAt: 1, creditedAt: 1 })).toBe(
      'You earned $10.00',
    )
    expect(progressCaption({ id: 'a', referee: 'x', status: 'qualified', creditsCents: 0, createdAt: 1, qualifiedAt: 1, creditedAt: 0 })).toBe(
      'Qualified — bonus landing',
    )
    expect(progressCaption({ id: 'a', referee: 'x', status: 'signed_up', creditsCents: 0, createdAt: 1, qualifiedAt: 0, creditedAt: 0 })).toBe(
      'Signed up — earns when they use Hanzo',
    )
  })
})
