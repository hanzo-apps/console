import { describe, expect, it } from 'vitest'

import { relativeTime } from './git'

describe('relativeTime', () => {
  it('renders a compact relative time for a past push', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    expect(relativeTime(twoHoursAgo)).toBe('updated 2h ago')
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000).toISOString()
    expect(relativeTime(threeDaysAgo)).toBe('updated 3d ago')
  })
  it('is honest about empty / unparseable input', () => {
    expect(relativeTime('')).toBe('')
    expect(relativeTime('not-a-date')).toBe('')
  })
  it('handles a very recent push', () => {
    expect(relativeTime(new Date().toISOString())).toBe('updated just now')
  })
})
