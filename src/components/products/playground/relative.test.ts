import { describe, it, expect } from 'vitest'

import { relativeTime } from './relative'

const NOW = 1_000_000_000_000

describe('relativeTime', () => {
  it('reads "just now" within a few seconds', () => {
    expect(relativeTime(NOW - 2_000, NOW)).toBe('just now')
  })
  it('reads seconds, minutes, hours, days', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('30s ago')
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago')
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago')
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago')
  })
  it('falls back to a date past a week', () => {
    expect(relativeTime(NOW - 30 * 86_400_000, NOW)).toBe(new Date(NOW - 30 * 86_400_000).toLocaleDateString())
  })
})
