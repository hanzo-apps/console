import { describe, it, expect } from 'vitest'

import { normalizeSettings } from './ai-accounts'

/**
 * The non-secret AI-accounts preferences blob (`routingEnabled`) is defensively
 * coerced and fail-closed to OFF — a tampered/absent/garbage blob must never read
 * as "routing enabled". This is the pure half of the sealed-cookie settings store
 * (the seal/open + cookie plumbing reuse the tested session AEAD).
 */
describe('normalizeSettings', () => {
  it('defaults routing OFF for absent/empty/garbage input', () => {
    expect(normalizeSettings(undefined)).toEqual({ routingEnabled: false })
    expect(normalizeSettings(null)).toEqual({ routingEnabled: false })
    expect(normalizeSettings({})).toEqual({ routingEnabled: false })
    expect(normalizeSettings('nope')).toEqual({ routingEnabled: false })
    expect(normalizeSettings(42)).toEqual({ routingEnabled: false })
  })

  it('only a strict boolean true enables routing (no truthy coercion)', () => {
    expect(normalizeSettings({ routingEnabled: true })).toEqual({ routingEnabled: true })
    expect(normalizeSettings({ routingEnabled: false })).toEqual({ routingEnabled: false })
    expect(normalizeSettings({ routingEnabled: 'true' })).toEqual({ routingEnabled: false })
    expect(normalizeSettings({ routingEnabled: 1 })).toEqual({ routingEnabled: false })
  })
})
