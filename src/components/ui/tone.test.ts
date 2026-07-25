import { describe, it, expect } from 'vitest'

import { toneColor, toneOfStatus, statusColor, type Tone } from './tone'

const TONES: Tone[] = ['positive', 'warning', 'critical', 'neutral', 'muted']

describe('tone', () => {
  it('is MONOCHROME — every tone resolves to a greyscale ramp token, never a hue', () => {
    for (const t of TONES) {
      expect(toneColor(t)).toMatch(/^\$color(9|1[0-2])$/)
    }
  })

  it('orders emphasis: critical is the brightest, muted the dimmest', () => {
    const weight = (token: string) => Number(token.replace('$color', ''))
    expect(weight(toneColor('critical'))).toBeGreaterThan(weight(toneColor('neutral')))
    expect(weight(toneColor('neutral'))).toBeGreaterThan(weight(toneColor('muted')))
    expect(weight(toneColor('warning'))).toBeGreaterThanOrEqual(weight(toneColor('neutral')))
  })

  it('maps the status vocabulary the backends emit', () => {
    expect(toneOfStatus('failed')).toBe('critical')
    expect(toneOfStatus('DEGRADED')).toBe('critical')
    expect(toneOfStatus('pending')).toBe('warning')
    expect(toneOfStatus('building')).toBe('warning')
    expect(toneOfStatus('running')).toBe('positive')
    expect(toneOfStatus('healthy')).toBe('positive')
  })

  it('never dresses an unknown or empty state as a failure', () => {
    expect(toneOfStatus('wat')).toBe('neutral')
    expect(toneOfStatus('')).toBe('neutral')
    expect(toneOfStatus('   ')).toBe('neutral')
  })

  it('statusColor composes the two — a raw status yields a greyscale token', () => {
    expect(statusColor('failed')).toBe(toneColor('critical'))
    expect(statusColor('ok')).toBe(toneColor('positive'))
    expect(statusColor('nonsense')).toMatch(/^\$color(9|1[0-2])$/)
  })
})
