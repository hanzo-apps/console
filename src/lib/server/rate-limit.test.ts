import { describe, it, expect } from 'vitest'

import { SlidingWindow, clientIp } from './rate-limit'

/**
 * The per-IP signup throttle. Uses an injected clock so the window boundary is
 * exercised deterministically (no real sleeps) — this is the ACTUAL limiter the
 * signup route calls, not a re-implementation.
 */
describe('SlidingWindow', () => {
  it('allows up to the limit, then blocks within the window', () => {
    let t = 1_000
    const w = new SlidingWindow(3, 1000, () => t)
    expect(w.allow('ip')).toBe(true)
    expect(w.allow('ip')).toBe(true)
    expect(w.allow('ip')).toBe(true)
    expect(w.allow('ip')).toBe(false) // 4th within the window
  })

  it('lets hits expire out of the window', () => {
    let t = 0
    const w = new SlidingWindow(2, 1000, () => t)
    expect(w.allow('ip')).toBe(true)
    expect(w.allow('ip')).toBe(true)
    expect(w.allow('ip')).toBe(false)
    t = 1001 // both prior hits are now older than the 1000ms window
    expect(w.allow('ip')).toBe(true)
  })

  it('keys independently per client', () => {
    let t = 0
    const w = new SlidingWindow(1, 1000, () => t)
    expect(w.allow('a')).toBe(true)
    expect(w.allow('a')).toBe(false)
    expect(w.allow('b')).toBe(true) // a different key has its own budget
  })

  it('limit <= 0 disables the limiter', () => {
    const w = new SlidingWindow(0, 1000)
    for (let i = 0; i < 100; i++) expect(w.allow('ip')).toBe(true)
  })
})

describe('clientIp', () => {
  const h = (init: Record<string, string>) => new Headers(init)

  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(clientIp(h({ 'x-real-ip': '198.51.100.5' }))).toBe('198.51.100.5')
  })

  it('returns empty when neither is present', () => {
    expect(clientIp(h({}))).toBe('')
  })
})
