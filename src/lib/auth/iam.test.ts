import { describe, expect, it } from 'vitest'

import { classifyRefreshFailure, expired, tokenExp } from './iam'

/** An unsigned JWT carrying exactly these claims — the shape the console decodes. */
const jwt = (claims: Record<string, unknown>): string => {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.signature-is-not-checked-here`
}

const NOW = Date.UTC(2026, 7, 14, 3, 0, 0)
const sec = (ms: number) => Math.floor(ms / 1000)

describe('tokenExp — the token states its own lifetime', () => {
  it('reads the exp claim', () => {
    expect(tokenExp(jwt({ exp: 1787284719 }))).toBe(1787284719)
  })

  it('is null for a token with no exp, a non-JWT, or nothing at all', () => {
    expect(tokenExp(jwt({ sub: 'z' }))).toBeNull()
    expect(tokenExp('not-a-jwt')).toBeNull()
    expect(tokenExp('')).toBeNull()
    expect(tokenExp(null)).toBeNull()
  })

  it('is null when exp is present but not a number', () => {
    expect(tokenExp(jwt({ exp: 'soon' }))).toBeNull()
  })
})

describe('expired — end a session only on evidence', () => {
  // THE DEFECT: a revoked session kept rendering the signed-in shell because an
  // expired access token was handed back as if it were live.
  it('is true for a token whose exp has passed', () => {
    expect(expired(jwt({ exp: sec(NOW) - 3600 }), NOW)).toBe(true)
  })

  it('is false for a token still in the future', () => {
    expect(expired(jwt({ exp: sec(NOW) + 3600 }), NOW)).toBe(false)
  })

  // The fallback this replaced exists because IAM can answer the exchange without
  // `expires_in`, leaving the SDK's own bookkeeping reading as already-elapsed while
  // IAM still accepts the token. An absent claim is not evidence of death.
  it('is false when the token states no exp at all', () => {
    expect(expired(jwt({ sub: 'z' }), NOW)).toBe(false)
    expect(expired('not-a-jwt', NOW)).toBe(false)
  })

  it('is false for no token — there is nothing to have expired', () => {
    expect(expired(null, NOW)).toBe(false)
  })

  it('counts the exact expiry instant as over', () => {
    expect(expired(jwt({ exp: sec(NOW) }), NOW)).toBe(true)
  })
})

describe('classifyRefreshFailure — OAuth already draws this line', () => {
  // 4xx is IAM's verdict on the GRANT: repeating it changes nothing. Retrying it
  // five times a page is what the console did instead.
  it('treats a 400 invalid_grant as refused', () => {
    expect(classifyRefreshFailure(new Error('Token refresh failed (400): {"error":"invalid_grant"}'))).toBe('refused')
  })

  it('treats 401 and 403 as refused too', () => {
    for (const s of [401, 403]) {
      expect(classifyRefreshFailure(new Error(`Token refresh failed (${s}): nope`))).toBe('refused')
    }
  })

  it('treats a 5xx as transient — the credential was never judged', () => {
    for (const s of [500, 502, 503]) {
      expect(classifyRefreshFailure(new Error(`Token refresh failed (${s}): upstream`))).toBe('transient')
    }
  })

  // Fail SAFE: an unclassifiable failure must never cost someone a live session.
  it('treats a network error, or anything unrecognized, as transient', () => {
    expect(classifyRefreshFailure(new Error('Failed to fetch'))).toBe('transient')
    expect(classifyRefreshFailure(new Error('No refresh token available'))).toBe('transient')
    expect(classifyRefreshFailure('a bare string')).toBe('transient')
    expect(classifyRefreshFailure(undefined)).toBe('transient')
  })
})
