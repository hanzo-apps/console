import { describe, it, expect } from 'vitest'

import { normalizeSettings } from './ai-accounts'

/**
 * The non-secret AI-accounts preferences blob (`routingEnabled`) is a defensively
 * coerced tri-state user OVERRIDE: a strict boolean is an explicit on/off, anything
 * else (absent/tampered/garbage) is `null` = "never touched" → follow the org default.
 * A tampered blob can never forge a boolean override; it reads as unset. This is the
 * pure half of the sealed-cookie settings store (the seal/open + cookie plumbing reuse
 * the tested session AEAD).
 */
describe('normalizeSettings', () => {
  it('defaults to the UNSET override (null → follow org default) for absent/empty/garbage input', () => {
    expect(normalizeSettings(undefined)).toEqual({ routingEnabled: null })
    expect(normalizeSettings(null)).toEqual({ routingEnabled: null })
    expect(normalizeSettings({})).toEqual({ routingEnabled: null })
    expect(normalizeSettings('nope')).toEqual({ routingEnabled: null })
    expect(normalizeSettings(42)).toEqual({ routingEnabled: null })
  })

  it('only a strict boolean is an explicit override (no truthy coercion)', () => {
    expect(normalizeSettings({ routingEnabled: true })).toEqual({ routingEnabled: true })
    expect(normalizeSettings({ routingEnabled: false })).toEqual({ routingEnabled: false })
    expect(normalizeSettings({ routingEnabled: 'true' })).toEqual({ routingEnabled: null })
    expect(normalizeSettings({ routingEnabled: 1 })).toEqual({ routingEnabled: null })
    expect(normalizeSettings({ routingEnabled: null })).toEqual({ routingEnabled: null })
  })
})
