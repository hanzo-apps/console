import { describe, expect, it } from 'vitest'

import {
  isReservedOrg,
  personalOrgSlug,
  slugifyOrg,
  validateOrgName,
  MAX_ORG_SLUG,
} from './onboarding'

describe('slugifyOrg', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyOrg('Max Power')).toBe('max-power')
    expect(slugifyOrg('Acme, Inc.')).toBe('acme-inc')
  })

  it('collapses and trims separators', () => {
    expect(slugifyOrg('  --Hello___World!!  ')).toBe('hello-world')
    expect(slugifyOrg('a   b')).toBe('a-b')
  })

  it('drops characters with no usable letters/numbers', () => {
    expect(slugifyOrg('!!!')).toBe('')
    expect(slugifyOrg('')).toBe('')
  })

  it('caps length and never ends in a hyphen', () => {
    const long = 'x'.repeat(80)
    expect(slugifyOrg(long).length).toBe(MAX_ORG_SLUG)
    // a slice landing on a separator must not leave a trailing hyphen
    const s = slugifyOrg('a-'.repeat(60))
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('personalOrgSlug', () => {
  it('uses the local part of an email-like username', () => {
    expect(personalOrgSlug('davelorenzini@gmail.com')).toBe('davelorenzini')
    expect(personalOrgSlug('dave@x.io')).toBe('dave')
  })

  it('slugifies a plain username', () => {
    expect(personalOrgSlug('Dave Lorenzini')).toBe('dave-lorenzini')
  })
})

describe('isReservedOrg / validateOrgName', () => {
  it('reserves the brand/staff and system orgs', () => {
    for (const r of ['hanzo', 'lux', 'zoo', 'pars', 'admin', 'built-in', 'app']) {
      expect(isReservedOrg(r)).toBe(true)
    }
    expect(isReservedOrg('maxpower')).toBe(false)
  })

  it('rejects reserved names even when typed with different casing/spacing', () => {
    const r = validateOrgName('  Hanzo ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/reserved/i)
  })

  it('rejects too-short names', () => {
    expect(validateOrgName('a').ok).toBe(false)
    expect(validateOrgName('!!').ok).toBe(false)
  })

  it('accepts and normalizes a real customer name', () => {
    const r = validateOrgName('Max Power LLC')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.slug).toBe('max-power-llc')
  })
})
