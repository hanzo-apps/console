import { describe, it, expect } from 'vitest'

import { slugError } from '~/lib/slug'

/**
 * Resource-name validation is shared by every create form (managed resources +
 * clusters). One rule, one place — so its edge cases are pinned here.
 */
describe('slugError', () => {
  it('accepts a typical DNS-ish name', () => {
    expect(slugError('my-resource')).toBeNull()
    expect(slugError('db1')).toBeNull()
    expect(slugError('a1')).toBeNull()
  })

  it('rejects too short / too long', () => {
    expect(slugError('a')).toBe('Use 2–40 characters.')
    expect(slugError('')).toBe('Use 2–40 characters.')
    expect(slugError('a'.repeat(41))).toBe('Use 2–40 characters.')
  })

  it('accepts exactly 40 chars and rejects 41', () => {
    expect(slugError('a' + 'b'.repeat(38) + 'c')).toBeNull() // 40
    expect(slugError('a' + 'b'.repeat(39) + 'c')).not.toBeNull() // 41
  })

  it('rejects consecutive hyphens', () => {
    expect(slugError('foo--bar')).toBe('No consecutive hyphens.')
  })

  it('rejects uppercase, leading digit/hyphen, trailing hyphen, symbols', () => {
    const msg =
      'Lowercase letters, numbers, hyphens; start with a letter, end alphanumeric.'
    expect(slugError('MyResource')).toBe(msg)
    expect(slugError('1abc')).toBe(msg)
    expect(slugError('-abc')).toBe(msg)
    expect(slugError('abc-')).toBe(msg)
    expect(slugError('a_b')).toBe(msg)
    expect(slugError('a b')).toBe(msg)
    expect(slugError('café')).toBe(msg)
  })
})
