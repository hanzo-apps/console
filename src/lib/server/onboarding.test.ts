import { describe, expect, it } from 'vitest'

import {
  isReservedOrg,
  personalOrgSlug,
  slugifyOrg,
  validateOrgName,
  MAX_ORG_SLUG,
  MIN_PASSWORD,
  validateSignup,
  deriveUsername,
  displayNameFromEmail,
  readOnboardRefusal,
  personalOrgFromEmail,
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

describe('validateSignup', () => {
  it('normalizes (trim + lowercase) a valid email', () => {
    const r = validateSignup('  Dave@Example.COM ', 'hunter2!!')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.email).toBe('dave@example.com')
      expect(r.password).toBe('hunter2!!')
    }
  })

  it('rejects a malformed email', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 'x@y', '@x.com']) {
      expect(validateSignup(bad, 'longenoughpw').ok).toBe(false)
    }
  })

  it('enforces the minimum password length', () => {
    const short = validateSignup('a@b.com', 'x'.repeat(MIN_PASSWORD - 1))
    expect(short.ok).toBe(false)
    expect(validateSignup('a@b.com', 'x'.repeat(MIN_PASSWORD)).ok).toBe(true)
  })
})

describe('deriveUsername / displayNameFromEmail', () => {
  it('derives a readable username from the email local part', () => {
    expect(deriveUsername('dave.lorenzini@example.com')).toBe('dave-lorenzini')
    expect(deriveUsername('***@x.com')).toBe('user') // local part has no usable chars → fallback
  })

  it('humanizes a display name', () => {
    expect(displayNameFromEmail('dave.lorenzini@example.com')).toBe('Dave Lorenzini')
    expect(displayNameFromEmail('acme_corp@x.com')).toBe('Acme Corp')
  })
})

describe('personalOrgFromEmail', () => {
  const digestA = 'aaaaaaaabbbbbbbb'
  const digestB = 'ccccccccdddddddd'

  it('is deterministic per email (same email → same slug)', () => {
    expect(personalOrgFromEmail('dave@x.com', digestA)).toBe(personalOrgFromEmail('dave@x.com', digestA))
  })

  it('is injective across emails: same local part, different domains do NOT collide', () => {
    // different emails hash to different digests → different slugs
    const a = personalOrgFromEmail('alice@x.com', digestA)
    const b = personalOrgFromEmail('alice@y.com', digestB)
    expect(a).not.toBe(b)
    expect(a.startsWith('alice-')).toBe(true)
    expect(b.startsWith('alice-')).toBe(true)
  })

  it('carries an 8-hex suffix and is never a reserved org', () => {
    const slug = personalOrgFromEmail('hanzo@x.com', 'deadbeefcafef00d')
    expect(slug).toBe('hanzo-deadbeef')
    expect(isReservedOrg(slug)).toBe(false) // the suffix defuses the reserved 'hanzo'
  })

  it('stays within MAX_ORG_SLUG for a long local part', () => {
    const slug = personalOrgFromEmail(`${'x'.repeat(120)}@x.com`, 'abcdef0123456789')
    expect(slug.length).toBeLessThanOrEqual(MAX_ORG_SLUG)
    expect(slug.endsWith('-abcdef01')).toBe(true)
  })

  it('falls back to a "user" base when the local part has no usable chars', () => {
    expect(personalOrgFromEmail('***@x.com', '12345678')).toBe('user-12345678')
  })
})

describe('readOnboardRefusal — the two different 409s', () => {
  it('recovers when the account already has an org: the first-run gate, not the name', () => {
    // IAM refused because onboarding would orphan the org this account admins. The
    // customer typed a perfectly free name and got a message about organizations.
    expect(
      readOnboardRefusal(409, 'you already have an organization; additional orgs are added separately', 'hanzo'),
    ).toEqual({ action: 'recover', org: 'hanzo' })
  })

  it('reports verbatim when the account has NO org: the name really is taken', () => {
    // Same status, opposite meaning. Nothing to recover into, and the server's
    // message is the accurate one.
    expect(readOnboardRefusal(409, 'the organization "coffee-cups" already exists', null)).toEqual({
      action: 'report',
      error: 'the organization "coffee-cups" already exists',
    })
  })

  it('never recovers on a non-409, even holding an org', () => {
    expect(readOnboardRefusal(400, '"admin" is reserved. choose a different name', 'hanzo')).toEqual({
      action: 'report',
      error: '"admin" is reserved. choose a different name',
    })
  })

  it('falls back to a status line when the server sent no message', () => {
    expect(readOnboardRefusal(500, undefined, null)).toEqual({
      action: 'report',
      error: 'Could not create the organization (HTTP 500).',
    })
  })
})
