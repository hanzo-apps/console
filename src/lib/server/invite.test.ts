import { describe, it, expect } from 'vitest'

import { signInvite, readInvite, inviteUserId, acceptLink, INVITE_TTL_MS, type Invite } from './invite'
import { seal } from './session'

const inv: Invite = { org: 'maxpower', name: 'davelorenzini-onboardtest', email: 'davelorenzini+onboardtest@gmail.com' }

describe('invite token — sign/read round-trip', () => {
  it('recovers the exact invite from its own token', () => {
    const token = signInvite(inv)
    expect(readInvite(token)).toEqual(inv)
  })

  it('rejects a tampered token (AEAD)', () => {
    const token = signInvite(inv)
    // flip the last char (still valid base64url) → auth tag mismatch → null
    const bad = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    expect(readInvite(bad)).toBeNull()
  })

  it('rejects an expired token', () => {
    const past = Date.now() - INVITE_TTL_MS - 1000
    const token = signInvite(inv, past)
    expect(readInvite(token)).toBeNull()
  })

  it('accepts a token right up to its expiry', () => {
    const now = 1_000_000_000_000
    const token = signInvite(inv, now)
    expect(readInvite(token, now + INVITE_TTL_MS - 1)).toEqual(inv)
    expect(readInvite(token, now + INVITE_TTL_MS + 1)).toBeNull()
  })

  it('rejects a null/empty/garbage token', () => {
    expect(readInvite(null)).toBeNull()
    expect(readInvite('')).toBeNull()
    expect(readInvite('not-a-real-token')).toBeNull()
  })

  it('rejects a sealed blob that is not an invite (wrong kind)', () => {
    // A session-shaped blob sealed with the same key must NOT read as an invite.
    expect(readInvite(seal({ e: Date.now() + 1000, c: { name: 'x' } }))).toBeNull()
    expect(readInvite(seal({ k: 'inv' }))).toBeNull() // missing o/n/m
    expect(readInvite(seal({ k: 'inv', o: 'maxpower', n: '', m: 'a@b.c', e: Date.now() + 1000 }))).toBeNull()
  })
})

describe('invite helpers', () => {
  it('builds the IAM user id from an invite', () => {
    expect(inviteUserId(inv)).toBe('maxpower/davelorenzini-onboardtest')
  })

  it('builds the accept link, trimming a trailing slash and encoding the token', () => {
    expect(acceptLink('https://console.hanzo.ai/', 'a b')).toBe('https://console.hanzo.ai/accept?t=a%20b')
    expect(acceptLink('https://console.hanzo.ai', 'tok')).toBe('https://console.hanzo.ai/accept?t=tok')
  })
})
